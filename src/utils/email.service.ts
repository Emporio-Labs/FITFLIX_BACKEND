import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config();

// build OAuth2 client using credentials from .env
// use refresh token so no browser login needed at runtime
const oauth2Client = new google.auth.OAuth2(
	process.env.GMAIL_CLIENT_ID,
	process.env.GMAIL_CLIENT_SECRET,
	process.env.GMAIL_REDIRECT_URI,
);

oauth2Client.setCredentials({
	refresh_token: process.env.GMAIL_REFRESH_TOKEN,
});

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

export const hasGmailWatchCredentials = (): boolean =>
	Boolean(
		process.env.GMAIL_CLIENT_ID &&
			process.env.GMAIL_CLIENT_SECRET &&
			process.env.GMAIL_REDIRECT_URI &&
			process.env.GMAIL_REFRESH_TOKEN,
	);

const getGmailWatchErrorMessage = (err: unknown): string => {
	if (err instanceof Error && err.message) {
		return err.message;
	}

	if (!err || typeof err !== "object") {
		return "Unknown error";
	}

	const candidate = err as {
		response?: {
			data?: {
				error?: string;
				error_description?: string;
			};
			status?: number;
		};
		code?: string | number;
		status?: number;
	};

	const apiError = candidate.response?.data?.error;
	const apiDescription = candidate.response?.data?.error_description;
	const status = candidate.response?.status ?? candidate.status;

	if (apiError || apiDescription) {
		const parts = [apiError, apiDescription].filter(Boolean);
		return `${parts.join(": ")}${status ? ` (status ${status})` : ""}`;
	}

	return "Unknown error";
};

const decodeBase64 = (data: string): string => {
	const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(normalized, "base64").toString("utf-8");
};

const extractTextBody = (payload: any): string => {
	if (!payload) return "";

	if (payload.mimeType === "text/plain" && payload.body?.data) {
		return decodeBase64(payload.body.data);
	}

	if (payload.mimeType?.startsWith("multipart/") && payload.parts) {
		for (const part of payload.parts) {
			const text = extractTextBody(part);
			if (text) return text;
		}
	}

	return "";
};

const findPdfAttachments = (
	payload: any,
): { filename: string; attachmentId: string }[] => {
	const attachments: { filename: string; attachmentId: string }[] = [];

	if (!payload) return attachments;

	// match application/pdf OR octet-stream OR any part with a .pdf filename
	const isPdf =
		payload.mimeType === "application/pdf" ||
		payload.mimeType === "application/octet-stream" ||
		(payload.filename && payload.filename.toLowerCase().endsWith(".pdf"));

	if (isPdf && payload.body?.attachmentId) {
		attachments.push({
			filename: payload.filename || "report.pdf",
			attachmentId: payload.body.attachmentId,
		});
	}

	if (payload.parts) {
		for (const part of payload.parts) {
			attachments.push(...findPdfAttachments(part));
		}
	}

	return attachments;
};

const logMimeParts = (payload: any, depth = 0): void => {
	if (!payload) return;

	const indent = "  ".repeat(depth);
	console.log(
		`${indent}mimeType: ${payload.mimeType}, filename: ${payload.filename || "-"}, hasAttachmentId: ${!!payload.body?.attachmentId}`,
	);

	if (payload.parts) {
		for (const part of payload.parts) {
			logMimeParts(part, depth + 1);
		}
	}
};

const normalizeExtractedPdfText = (text: string): string => {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	if (lines.length === 0) return "";

	const lineCounts = new Map<string, number>();
	for (const line of lines) {
		lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
	}

	// Drop repeated footer/header lines that appear on multiple pages.
	const cleanedLines = lines.filter((line) => {
		const repeated = (lineCounts.get(line) ?? 0) > 1;
		const likelyBoilerplate =
			/^hPod$/i.test(line) ||
			/^Page\s+\d+\s+of\s+\d+/i.test(line) ||
			/^This report is digitally generated$/i.test(line);

		return !(repeated && likelyBoilerplate);
	});

	return cleanedLines.join("\n").trim();
};

const extractPdfText = async (
	messageId: string,
	attachmentId: string,
): Promise<string> => {
	try {
		const { PDFParse } = await import("pdf-parse");

		const res = await gmail.users.messages.attachments.get({
			userId: "me",
			messageId,
			id: attachmentId,
		});

		// normalize base64url -> standard base64
		const base64url = res.data.data as string;
		const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
		const buffer = Buffer.from(base64, "base64");

		const parser = new PDFParse({ data: buffer });
		const parsed = await parser.getText({
			lineEnforce: true,
			lineThreshold: 3.2,
			cellSeparator: " | ",
			cellThreshold: 4,
			pageJoiner: "\n-- page_number of total_number --\n",
		});

		const tableResult = await parser.getTable();
		await parser.destroy();

		const tableBlocks: string[] = [];
		for (const page of tableResult.pages) {
			for (const table of page.tables) {
				if (!table.length) continue;
				const tableText = table
					.map((row) => row.map((cell) => cell.trim()).join(" | "))
					.join("\n");
				if (tableText.trim()) {
					tableBlocks.push(`[TABLE page ${page.num}]\n${tableText}`);
				}
			}
		}

		const merged = [parsed.text || "", ...tableBlocks]
			.filter(Boolean)
			.join("\n\n");
		const normalized = normalizeExtractedPdfText(merged);

		console.log(
			`[PDF] extracted chars=${normalized.length}, tables=${tableBlocks.length}`,
		);

		return normalized;
	} catch (err) {
		console.error("Failed to extract PDF text:", err);
		return "";
	}
};

// extract patient email from PDF text
// hPod report has "Email\n<value>" or "Email <value>"
export const extractPatientEmailFromPdf = (pdfText: string): string | null => {
	const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
	const matches = pdfText.match(emailRegex) || [];

	const patient = matches.find(
		(email) =>
			!email.toLowerCase().includes("hpod.in") &&
			!email.toLowerCase().includes("healthlink"),
	);

	return patient || null;
};

// fetch full email - text body + PDF text combined
export const fetchEmailById = async (messageId: string) => {
	try {
		const res = await gmail.users.messages.get({
			userId: "me",
			id: messageId,
			format: "full",
		});

		const headers: Record<string, string> = {};
		for (const h of res.data.payload?.headers || []) {
			if (h.name && h.value) headers[h.name] = h.value;
		}

		// log MIME structure to debug attachment detection
		console.log("[MIME PARTS]:");
		logMimeParts(res.data.payload);

		const bodyText = extractTextBody(res.data.payload);
		const pdfAttachments = findPdfAttachments(res.data.payload);
		const pdfTexts: string[] = [];
		let patientEmail: string | null = null;

		for (const att of pdfAttachments) {
			console.log(`Extracting PDF: ${att.filename}`);
			const text = await extractPdfText(messageId, att.attachmentId);
			if (text) {
				pdfTexts.push(`--- ${att.filename} ---\n${text}`);
				if (!patientEmail) {
					patientEmail = extractPatientEmailFromPdf(text);
				}
			}
		}

		const pdfFullText = pdfTexts.join("\n\n");

		const combinedBody = [
			bodyText && `[Email Body]\n${bodyText}`,
			pdfFullText && `[PDF Report]\n${pdfFullText}`,
		]
			.filter(Boolean)
			.join("\n\n");

		return {
			gmailMessageId: messageId,
			sender: headers["From"] || "unknown",
			subject: headers["Subject"] || "(no subject)",
			body: combinedBody || "(empty)",
			pdfText: pdfFullText,
			patientEmail,
			hasPdf: pdfAttachments.length > 0,
		};
	} catch (err) {
		console.error(`Failed to fetch message ${messageId}:`, err);
		return null;
	}
};

// track previous historyId
let lastHistoryId: string | null = null;

export const getMessageIdsFromHistory = async (
	historyId: string,
): Promise<string[]> => {
	if (!lastHistoryId) {
		console.log(`[history] First call - storing ${historyId} as baseline`);
		lastHistoryId = historyId;
		return [];
	}

	const queryId = lastHistoryId;
	lastHistoryId = historyId;

	console.log(`[history] Querying since ${queryId} (current: ${historyId})`);

	try {
		const res = await gmail.users.history.list({
			userId: "me",
			startHistoryId: queryId,
			historyTypes: ["messageAdded"],
		});

		const messageIds: string[] = [];

		for (const record of res.data.history || []) {
			for (const added of record.messagesAdded || []) {
				if (added.message?.id) {
					messageIds.push(added.message.id);
				}
			}
		}

		return messageIds;
	} catch (err) {
		console.error("Failed to fetch history:", err);
		return [];
	}
};

export const registerGmailWatch = async (topicName: string): Promise<void> => {
	try {
		const res = await gmail.users.watch({
			userId: "me",
			requestBody: {
				labelIds: ["INBOX"],
				topicName,
			},
		});
		console.log("Gmail watch registered. Expires:", res.data.expiration);
	} catch (err) {
		console.error(
			`Failed to register Gmail watch: ${getGmailWatchErrorMessage(err)}`,
		);
	}
};
