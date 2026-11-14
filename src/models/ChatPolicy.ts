import mongoose from "mongoose";
import { CHAT_PARTICIPANT_KINDS } from "./ChatConversation";

/**
 * Admin-edited chat rules. One global document.
 *
 * Only the rules an admin has changed are stored; everything else falls back
 * to DEFAULT_RULES in `services/chat/policy.ts`. That keeps a new role or a
 * changed default from being shadowed by a stale saved copy.
 */
const chatPolicySchema = new mongoose.Schema(
	{
		rules: {
			type: [
				new mongoose.Schema(
					{
						from: { type: String, required: true },
						to: { type: String, required: true },
						mode: {
							type: String,
							enum: ["none", "assigned", "all"],
							required: true,
						},
					},
					{ _id: false },
				),
			],
			default: [],
		},
		// A member with no active membership can only reach admins and the front
		// desk. On by default; stored only once an admin changes it.
		requireActiveMembership: { type: Boolean, default: true },
		updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
	},
	{ timestamps: true },
);

export type ChatPolicyDocument = mongoose.InferSchemaType<
	typeof chatPolicySchema
>;

export const ChatPolicy =
	(mongoose.models.ChatPolicy as mongoose.Model<ChatPolicyDocument>) ||
	mongoose.model<ChatPolicyDocument>("ChatPolicy", chatPolicySchema);

/**
 * Per-person exceptions to the role rules — the "let this trainer talk to
 * other staff" toggle.
 */
const chatOverrideSchema = new mongoose.Schema(
	{
		kind: { type: String, enum: CHAT_PARTICIPANT_KINDS, required: true },
		personId: { type: mongoose.Schema.Types.ObjectId, required: true },
		// May start a chat with any other staff member.
		staffChat: { type: Boolean, default: false },
		// May start a chat with any member, not just the ones assigned to them.
		allClients: { type: Boolean, default: false },
		// Cannot send or receive at all.
		chatDisabled: { type: Boolean, default: false },
		updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
	},
	{ timestamps: true },
);

chatOverrideSchema.index({ kind: 1, personId: 1 }, { unique: true });

export type ChatOverrideDocument = mongoose.InferSchemaType<
	typeof chatOverrideSchema
>;

export const ChatOverride =
	(mongoose.models.ChatOverride as mongoose.Model<ChatOverrideDocument>) ||
	mongoose.model<ChatOverrideDocument>("ChatOverride", chatOverrideSchema);

/** One person refusing to hear from another. Admins cannot be blocked. */
const chatBlockSchema = new mongoose.Schema(
	{
		blockerKind: { type: String, enum: CHAT_PARTICIPANT_KINDS, required: true },
		blockerId: { type: mongoose.Schema.Types.ObjectId, required: true },
		blockedKind: { type: String, enum: CHAT_PARTICIPANT_KINDS, required: true },
		blockedId: { type: mongoose.Schema.Types.ObjectId, required: true },
	},
	{ timestamps: true },
);

chatBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
chatBlockSchema.index({ blockedId: 1 });

export type ChatBlockDocument = mongoose.InferSchemaType<
	typeof chatBlockSchema
>;

export const ChatBlock =
	(mongoose.models.ChatBlock as mongoose.Model<ChatBlockDocument>) ||
	mongoose.model<ChatBlockDocument>("ChatBlock", chatBlockSchema);

export const CHAT_REPORT_REASONS = [
	"harassment",
	"inappropriate",
	"spam",
	"other",
] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

/** A conversation (optionally one message in it) flagged for an admin. */
const chatReportSchema = new mongoose.Schema(
	{
		conversationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ChatConversation",
			required: true,
		},
		messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
		// Copied at report time: the reporter may delete the thread's context
		// later, and a deleted message must still be reviewable.
		messageBody: { type: String, default: "" },
		reporterKind: {
			type: String,
			enum: CHAT_PARTICIPANT_KINDS,
			required: true,
		},
		reporterId: { type: mongoose.Schema.Types.ObjectId, required: true },
		reporterName: { type: String, default: "" },
		reportedKind: {
			type: String,
			enum: CHAT_PARTICIPANT_KINDS,
			required: true,
		},
		reportedId: { type: mongoose.Schema.Types.ObjectId, required: true },
		reportedName: { type: String, default: "" },
		reason: { type: String, enum: CHAT_REPORT_REASONS, required: true },
		note: { type: String, default: "", maxlength: 1000 },
		status: { type: String, enum: ["open", "resolved"], default: "open" },
		resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
		resolvedAt: { type: Date, default: null },
		resolutionNote: { type: String, default: "", maxlength: 1000 },
	},
	{ timestamps: true },
);

chatReportSchema.index({ status: 1, createdAt: -1 });

export type ChatReportDocument = mongoose.InferSchemaType<
	typeof chatReportSchema
>;

export const ChatReport =
	(mongoose.models.ChatReport as mongoose.Model<ChatReportDocument>) ||
	mongoose.model<ChatReportDocument>("ChatReport", chatReportSchema);
