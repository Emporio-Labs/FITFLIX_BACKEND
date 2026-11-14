import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Request, RequestHandler, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { CHAT_PARTICIPANT_KINDS } from "../models/ChatConversation";
import { CHAT_MESSAGE_MAX_LENGTH } from "../models/ChatMessage";
import { CHAT_REPORT_REASONS, ChatOverride } from "../models/ChatPolicy";
import { generatePresignedPutUrl, generateSignedUrl } from "../utils/s3.service";
import {
	adminGetConversation,
	adminListConversations,
	blockPerson,
	ChatError,
	countOpenReports,
	deleteMessage,
	deleteReaction,
	getConversation,
	getUnreadCount,
	listBlocked,
	listContacts,
	listConversations,
	listMessages,
	listReports,
	markRead,
	openConversation,
	reportConversation,
	resolveReport,
	sendMessage,
	toggleReaction,
	unblockPerson,
} from "../services/chat/chat.service";
import {
	actorFromAuth,
	CHAT_ROLES,
	type ChatPerson,
	type ChatRole,
	listPeople,
	loadPerson,
	personKey,
} from "../services/chat/people";
import {
	ChatPolicyError,
	getChatSettings,
	getPolicyMatrix,
	resetPolicy,
	updateChatSettings,
	updatePolicy,
} from "../services/chat/policy";
import { assignableRoles } from "../services/chat/relationships";
import type { AuthenticatedUser } from "../types/auth";

const fail = (res: Response, status: number, code: string, error: string) => {
	res.status(status).json({ error, message: error, code });
};

type ChatHandler = (
	req: Request,
	res: Response,
	user: AuthenticatedUser,
) => Promise<unknown>;

const handle =
	(fn: ChatHandler): RequestHandler =>
	async (req, res, next) => {
		if (!req.user) {
			fail(res, 401, "UNAUTHORIZED", "Unauthorized");
			return;
		}
		try {
			await fn(req, res, req.user);
		} catch (error) {
			if (error instanceof ChatError) {
				res.status(error.status).json({
					error: error.message,
					message: error.message,
					code: error.code,
					...(error.reason ? { reason: error.reason } : {}),
				});
				return;
			}
			if (error instanceof ChatPolicyError) {
				fail(res, 400, "BAD_REQUEST", error.message);
				return;
			}
			next(error);
		}
	};

const invalid = (res: Response, error: z.ZodError) => {
	res.status(400).json({
		error: "Validation failed",
		code: "VALIDATION_ERROR",
		details: Object.fromEntries(
			error.issues.map((i) => [i.path.join(".") || "body", i.message]),
		),
	});
};

const objectId = z
	.string()
	.refine((v) => mongoose.Types.ObjectId.isValid(v), "Invalid id");

const openSchema = z.object({
	kind: z.enum(CHAT_PARTICIPANT_KINDS),
	id: objectId,
});

const mediaSchema = z.object({
	s3Key: z.string().trim().min(1),
	url: z.string().trim().min(1),
	thumbnailUrl: z.string().trim().optional(),
	mimeType: z.string().trim().min(1),
	byteSize: z.number().int().positive(),
	durationSeconds: z.number().positive().optional(),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
});

const sendSchema = z
	.object({
		body: z.string().trim().max(CHAT_MESSAGE_MAX_LENGTH).default(""),
		clientMessageId: z.string().trim().min(1).max(64).optional(),
		kind: z
			.enum([
				"text",
				"image",
				"video",
				"audio",
				"activity_card",
				"exercise_share",
			])
			.optional(),
		payload: z.record(z.string(), z.unknown()).optional(),
		media: mediaSchema.optional(),
	})
	.refine(
		(data) => {
			if (
				data.media ||
				data.kind === "activity_card" ||
				data.kind === "exercise_share"
			) {
				return true;
			}
			return data.body.length > 0;
		},
		{
			message: "Message text or media attachment is required",
			path: ["body"],
		},
	);

const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES: Record<string, string[]> = {
	image: [
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/heic",
		"image/heif",
		"image/gif",
	],
	audio: [
		"audio/m4a",
		"audio/mp4",
		"audio/aac",
		"audio/mpeg",
		"audio/wav",
		"audio/ogg",
		"audio/webm",
		"audio/x-m4a",
	],
	video: [
		"video/mp4",
		"video/quicktime",
		"video/webm",
		"video/3gpp",
	],
};

const presignMediaSchema = z
	.object({
		fileName: z.string().trim().min(1).max(255),
		mimeType: z.string().trim().toLowerCase(),
		byteSize: z.number().int().positive(),
		kind: z.enum(["image", "video", "audio"]),
	})
	.refine(
		(data) => {
			const allowed = ALLOWED_MIME_TYPES[data.kind];
			return allowed && allowed.includes(data.mimeType);
		},
		{
			message: "Unsupported file type for this media category",
			path: ["mimeType"],
		},
	)
	.refine(
		(data) => {
			if (data.kind === "image" && data.byteSize > MAX_IMAGE_BYTES) return false;
			if (data.kind === "audio" && data.byteSize > MAX_AUDIO_BYTES) return false;
			if (data.kind === "video" && data.byteSize > MAX_VIDEO_BYTES) return false;
			return true;
		},
		{
			message: "File exceeds maximum permitted size",
			path: ["byteSize"],
		},
	);

const reactionSchema = z.object({
	reaction: z.string().trim().min(1).max(32),
});

const roleSchema = z.enum(CHAT_ROLES);

const policySchema = z.object({
	rules: z
		.array(
			z.object({
				from: roleSchema,
				to: roleSchema,
				mode: z.enum(["none", "assigned", "all"]),
			}),
		)
		.min(1)
		.max(CHAT_ROLES.length * CHAT_ROLES.length),
});

const overrideSchema = z
	.object({
		staffChat: z.boolean().optional(),
		allClients: z.boolean().optional(),
		chatDisabled: z.boolean().optional(),
	})
	.refine((v) => Object.keys(v).length > 0, "Nothing to update");

const param = (value: unknown): string =>
	typeof value === "string" ? value : "";

// ── Everyone ─────────────────────────────────────────────────────────────────

export const getContacts: RequestHandler = handle(async (req, res, user) => {
	const search =
		typeof req.query.search === "string" ? req.query.search : undefined;
	const contacts = await listContacts(actorFromAuth(user), { search });
	res.json({ contacts });
});

export const getConversations: RequestHandler = handle(
	async (_req, res, user) => {
		const me = actorFromAuth(user);
		const [conversations, unreadCount] = await Promise.all([
			listConversations(me),
			getUnreadCount(me),
		]);
		res.json({ conversations, unreadCount, me });
	},
);

export const postConversation: RequestHandler = handle(
	async (req, res, user) => {
		const parsed = openSchema.safeParse(req.body);
		if (!parsed.success) return invalid(res, parsed.error);
		const conversation = await openConversation(
			actorFromAuth(user),
			parsed.data,
		);
		res.status(200).json({ conversation });
	},
);

export const getConversationById: RequestHandler = handle(
	async (req, res, user) => {
		const conversation = await getConversation(
			actorFromAuth(user),
			param(req.params.id),
		);
		res.json({ conversation });
	},
);

export const getMessages: RequestHandler = handle(async (req, res, user) => {
	const limit = Number(req.query.limit);
	const result = await listMessages(actorFromAuth(user), param(req.params.id), {
		before: typeof req.query.before === "string" ? req.query.before : undefined,
		limit: Number.isFinite(limit) ? limit : undefined,
	});
	res.json(result);
});

export const postMessage: RequestHandler = handle(async (req, res, user) => {
	const parsed = sendSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const message = await sendMessage(
		actorFromAuth(user),
		param(req.params.id),
		parsed.data,
	);
	res.status(201).json({ message });
});

export const presignChatMedia: RequestHandler = handle(
	async (req, res, user) => {
		const conversationId = param(req.params.id);
		const conv = await getConversation(actorFromAuth(user), conversationId);
		if (!conv) {
			return fail(res, 404, "NOT_FOUND", "Conversation not found");
		}
		if (!conv.canSend) {
			return fail(
				res,
				403,
				"FORBIDDEN",
				conv.blockedReason ?? "Sending is blocked in this conversation",
			);
		}

		const parsed = presignMediaSchema.safeParse(req.body);
		if (!parsed.success) return invalid(res, parsed.error);

		const { fileName, mimeType, byteSize, kind } = parsed.data;
		const ext =
			path.extname(fileName) ||
			(kind === "image" ? ".jpg" : kind === "audio" ? ".m4a" : ".mp4");
		const sanitizedExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
		const s3Key = `chat-media/${conversationId}/${Date.now()}-${randomUUID()}${sanitizedExt}`;

		const uploadUrl = await generatePresignedPutUrl(
			s3Key,
			mimeType,
			byteSize,
			900,
		);
		const url = await generateSignedUrl(s3Key, 86400 * 7, mimeType);

		res.status(200).json({
			uploadUrl,
			downloadUrl: url,
			s3Key,
			url,
		});
	},
);

export const postReaction: RequestHandler = handle(async (req, res, user) => {
	const parsed = reactionSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const result = await toggleReaction(
		actorFromAuth(user),
		param(req.params.id),
		param(req.params.messageId),
		parsed.data.reaction,
	);
	res.status(200).json(result);
});

export const deleteReactionById: RequestHandler = handle(
	async (req, res, user) => {
		const result = await deleteReaction(
			actorFromAuth(user),
			param(req.params.id),
			param(req.params.messageId),
		);
		res.status(200).json(result);
	},
);

export const postRead: RequestHandler = handle(async (req, res, user) => {
	const result = await markRead(actorFromAuth(user), param(req.params.id));
	res.json(result);
});

export const getUnread: RequestHandler = handle(async (_req, res, user) => {
	res.json({ unreadCount: await getUnreadCount(actorFromAuth(user)) });
});

// ── Admin: rules ─────────────────────────────────────────────────────────────

const policyResponse = async (
	rules: Awaited<ReturnType<typeof getPolicyMatrix>>,
) => ({
	roles: CHAT_ROLES,
	assignableRoles: assignableRoles(),
	rules,
	settings: await getChatSettings(),
});

export const getPolicy: RequestHandler = handle(async (_req, res) => {
	res.json(await policyResponse(await getPolicyMatrix()));
});

export const putPolicy: RequestHandler = handle(async (req, res, user) => {
	const parsed = policySchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const rules = await updatePolicy(parsed.data.rules, user.id);
	res.json({ message: "Chat rules updated", ...(await policyResponse(rules)) });
});

export const postPolicyReset: RequestHandler = handle(
	async (_req, res, user) => {
		const rules = await resetPolicy(user.id);
		res.json({
			message: "Chat rules reset to defaults",
			...(await policyResponse(rules)),
		});
	},
);

// ── Admin: per-person toggles ────────────────────────────────────────────────

const STAFF_LIST_ROLES: ChatRole[] = [
	"trainer",
	"nutritionist",
	"sports_scientist",
	"doctor",
];

const withOverrides = async (people: ChatPerson[]) => {
	const rows = await ChatOverride.find({
		personId: { $in: people.map((p) => p.id) },
	}).lean<
		Array<{
			kind: string;
			personId: unknown;
			staffChat?: boolean;
			allClients?: boolean;
			chatDisabled?: boolean;
		}>
	>();
	const byKey = new Map(
		rows.map((r) => [personKey({ kind: r.kind, id: String(r.personId) }), r]),
	);
	return people.map((p) => {
		const o = byKey.get(personKey(p));
		return {
			kind: p.kind,
			id: p.id,
			role: p.role,
			name: p.name,
			avatarUrl: p.avatarUrl,
			staffChat: Boolean(o?.staffChat),
			allClients: Boolean(o?.allClients),
			chatDisabled: Boolean(o?.chatDisabled),
		};
	});
};

/** Staff (default) or members (`?role=client&search=`) with their chat toggles. */
export const getPeopleOverrides: RequestHandler = handle(async (req, res) => {
	const search =
		typeof req.query.search === "string" ? req.query.search : undefined;
	const role = typeof req.query.role === "string" ? req.query.role : "";
	const roles =
		role === "client" ? (["client"] as ChatRole[]) : STAFF_LIST_ROLES;
	const groups = await Promise.all(
		roles.map((r) =>
			listPeople(r, { search, limit: role === "client" ? 30 : 200 }),
		),
	);
	res.json({ people: await withOverrides(groups.flat()) });
});

export const putOverride: RequestHandler = handle(async (req, res, user) => {
	const kind = z.enum(CHAT_PARTICIPANT_KINDS).safeParse(req.params.kind);
	const id = objectId.safeParse(req.params.id);
	const parsed = overrideSchema.safeParse(req.body);
	if (!kind.success || !id.success) {
		fail(res, 400, "BAD_REQUEST", "Invalid person");
		return;
	}
	if (!parsed.success) return invalid(res, parsed.error);
	if (kind.data === "Admin") {
		fail(res, 400, "BAD_REQUEST", "Admins can always chat with everyone");
		return;
	}
	const person = await loadPerson(kind.data, id.data);
	if (!person) {
		fail(res, 404, "NOT_FOUND", "Person not found");
		return;
	}
	await ChatOverride.findOneAndUpdate(
		{ kind: kind.data, personId: id.data },
		{ $set: { ...parsed.data, updatedBy: user.id } },
		{ upsert: true },
	);
	const [updated] = await withOverrides([person]);
	res.json({ message: "Chat access updated", person: updated });
});

// ── Everyone: delete, block, report ──────────────────────────────────────────

const reportSchema = z.object({
	reason: z.enum(CHAT_REPORT_REASONS),
	note: z.string().trim().max(1000).optional(),
	messageId: objectId.optional(),
});

export const deleteMessageById: RequestHandler = handle(
	async (req, res, user) => {
		res.json(await deleteMessage(actorFromAuth(user), param(req.params.id)));
	},
);

export const getBlocked: RequestHandler = handle(async (_req, res, user) => {
	res.json({ blocked: await listBlocked(actorFromAuth(user)) });
});

export const postBlock: RequestHandler = handle(async (req, res, user) => {
	const parsed = openSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const person = await blockPerson(actorFromAuth(user), parsed.data);
	res.json({ message: `${person.name} is blocked`, person });
});

export const deleteBlock: RequestHandler = handle(async (req, res, user) => {
	const parsed = openSchema.safeParse({
		kind: req.params.kind,
		id: req.params.id,
	});
	if (!parsed.success) return invalid(res, parsed.error);
	await unblockPerson(actorFromAuth(user), parsed.data);
	res.json({ message: "Unblocked" });
});

export const postReport: RequestHandler = handle(async (req, res, user) => {
	const parsed = reportSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const report = await reportConversation(
		actorFromAuth(user),
		param(req.params.id),
		parsed.data,
	);
	res.status(201).json({
		message: "Thanks — the Fitflix team will review this",
		report: { id: report.id },
	});
});

// ── Admin: settings, reports, oversight ──────────────────────────────────────

const settingsSchema = z.object({ requireActiveMembership: z.boolean() });

const resolveSchema = z.object({
	status: z.enum(["open", "resolved"]),
	resolutionNote: z.string().trim().max(1000).optional(),
});

export const putSettings: RequestHandler = handle(async (req, res, user) => {
	const parsed = settingsSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const settings = await updateChatSettings(parsed.data, user.id);
	res.json({ message: "Chat settings updated", settings });
});

export const getReports: RequestHandler = handle(async (req, res) => {
	const status =
		req.query.status === "open" || req.query.status === "resolved"
			? req.query.status
			: undefined;
	const [reports, openCount] = await Promise.all([
		listReports(status),
		countOpenReports(),
	]);
	res.json({ reports, openCount });
});

export const patchReport: RequestHandler = handle(async (req, res, user) => {
	const parsed = resolveSchema.safeParse(req.body);
	if (!parsed.success) return invalid(res, parsed.error);
	const report = await resolveReport(
		actorFromAuth(user),
		param(req.params.id),
		parsed.data,
	);
	res.json({ message: "Report updated", report });
});

export const getAllConversations: RequestHandler = handle(async (req, res) => {
	const search =
		typeof req.query.search === "string" ? req.query.search : undefined;
	res.json({ conversations: await adminListConversations({ search }) });
});

export const getAnyConversation: RequestHandler = handle(async (req, res) => {
	const limit = Number(req.query.limit);
	res.json(
		await adminGetConversation(param(req.params.id), {
			before:
				typeof req.query.before === "string" ? req.query.before : undefined,
			limit: Number.isFinite(limit) ? limit : undefined,
		}),
	);
});
