import type { Request, Response } from "express";
import { Router } from "express";
import mongoose from "mongoose";
import { HpodReport } from "../models/Hpodreport.model";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { verifyWebhookSecret } from "../middleware/webhook-auth.middleware";
import {
	fetchEmailById,
	getMessageIdsFromHistory,
} from "../utils/email.service";
import { generateHpodSummary } from "../utils/llm.service";

const router = Router();

const ALLOWED_SENDER = "noreply@hpod.in";

const extractEmail = (sender: string): string => {
	const match = sender.match(/<(.+?)>/);
	return match?.[1] ?? sender.trim();
};

const findUserByEmail = async (
	email: string,
): Promise<mongoose.Types.ObjectId | null> => {
	const db = mongoose.connection.db;
	if (!db) return null;
	const user = await db
		.collection("users")
		.findOne({ email }, { projection: { _id: 1 } });
	return user ? user._id : null;
};

router.post("/email", verifyWebhookSecret, async (req: Request, res: Response) => {
	try {
		const message = req.body?.message;
		if (!message?.data) {
			return res.status(400).json({ error: "No message data" });
		}

		const decoded = Buffer.from(message.data, "base64").toString("utf-8");
		const notification = JSON.parse(decoded);
		const historyId: string = notification.historyId;

		if (!historyId) {
			return res.status(200).json({ status: "no historyId" });
		}

		const messageIds = await getMessageIdsFromHistory(historyId);
		console.log(`Processing ${messageIds.length} new message(s)`);

		for (const msgId of messageIds) {
			const email = await fetchEmailById(msgId);
			if (!email) continue;

			const senderEmail = extractEmail(email.sender);

			// only process emails from hPod
			if (senderEmail.toLowerCase() !== ALLOWED_SENDER) {
				console.log(`Skipped - not from HPOD (${senderEmail})`);
				continue;
			}

			// look up patient by email extracted from PDF
			let userId: mongoose.Types.ObjectId | null = null;
			let userEmail = "unknown";

			if (email.patientEmail) {
				userEmail = email.patientEmail;
				userId = await findUserByEmail(email.patientEmail);
				console.log(
					`Patient email from PDF: ${email.patientEmail} -> userId: ${userId}`,
				);
			} else {
				console.log("No patient email found in PDF");
			}

			// call GPT to extract structured summary from PDF text
			let aiSummary: Record<string, any> | null = null;
			let summaryGeneratedAt: Date | null = null;

			if (email.pdfText) {
				console.log("Sending PDF to GPT for summary...");
				aiSummary = await generateHpodSummary(email.pdfText);
				summaryGeneratedAt = aiSummary ? new Date() : null;
				console.log(`Summary generated: ${Boolean(aiSummary)}`);

				// if GPT extracted patient email and we did not get it from regex
				const gptPatientEmail = aiSummary?.patientEmail;
				if (!userId && typeof gptPatientEmail === "string" && gptPatientEmail) {
					userEmail = gptPatientEmail;
					userId = await findUserByEmail(gptPatientEmail);
					console.log(
						`Patient email from GPT: ${gptPatientEmail} -> userId: ${userId}`,
					);
				}
			} else {
				console.log("No PDF text found - skipping LLM");
			}

			// save to MongoDB
			await HpodReport.findOneAndUpdate(
				{ gmailMessageId: email.gmailMessageId },
				{
					$setOnInsert: {
						userId,
						userEmail,
						gmailMessageId: email.gmailMessageId,
						subject: email.subject,
						sender: email.sender,
						rawBody: email.body,
						hasPdf: email.hasPdf,
						aiSummary,
						summaryGeneratedAt,
						receivedAt: new Date(),
					},
				},
				{ upsert: true, returnDocument: "after" },
			);

			console.log(
				`Saved HPOD report - patient: ${userEmail}, userId: ${userId}`,
			);
		}

		return res.status(200).json({ status: "ok", processed: messageIds.length });
	} catch (err) {
		console.error("Webhook error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

router.use(authenticateToken);
router.use(authorize(["admin"]));

// GET /webhook/reports — list all reports (for app to consume)
router.get("/reports", async (_req: Request, res: Response) => {
	const reports = await HpodReport.find()
		.sort({ receivedAt: -1 })
		.select("-rawBody") // exclude heavy field from list view
		.populate("userId", "username email age gender healthGoals");

	return res.json({ reports });
});

// GET /webhook/reports/:id — single report with full body + summary
router.get("/reports/:id", async (req: Request, res: Response) => {
	const report = await HpodReport.findById(req.params.id).populate(
		"userId",
		"username email age gender healthGoals",
	);

	if (!report) return res.status(404).json({ error: "Not found" });
	return res.json(report);
});

// GET /webhook/reports/user/:userId — all reports for a specific user
router.get("/reports/user/:userId", async (req: Request, res: Response) => {
	const reports = await HpodReport.find({ userId: req.params.userId })
		.sort({ receivedAt: -1 })
		.populate("userId", "username email age gender healthGoals");

	return res.json({ reports });
});

export default router;
