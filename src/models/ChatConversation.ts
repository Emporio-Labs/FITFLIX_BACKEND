import mongoose from "mongoose";

/**
 * A direct (1-to-1) chat thread.
 *
 * People in Fitflix live in three collections — `User` (members, and staff
 * stored as users with `staffRole`), `Trainer` and `Admin` — so a participant
 * is addressed by `{ kind, id }`, never by a bare id.
 *
 * Who may talk to whom is NOT stored here. It is decided on every send by
 * `services/chat/policy.ts`, so switching a rule off turns existing threads
 * read-only instead of leaving a back door open.
 */
export const CHAT_PARTICIPANT_KINDS = ["User", "Trainer", "Admin"] as const;
export type ChatParticipantKind = (typeof CHAT_PARTICIPANT_KINDS)[number];

const participantSchema = new mongoose.Schema(
	{
		kind: { type: String, enum: CHAT_PARTICIPANT_KINDS, required: true },
		id: { type: mongoose.Schema.Types.ObjectId, required: true },
		// Snapshots taken when the thread was opened (refreshed on send), so the
		// inbox renders without three lookups per row.
		role: { type: String, required: true },
		name: { type: String, default: "" },
		avatarUrl: { type: String, default: "" },
		unreadCount: { type: Number, default: 0, min: 0 },
		lastReadAt: { type: Date, default: null },
	},
	{ _id: false },
);

const chatConversationSchema = new mongoose.Schema(
	{
		// Only "direct" exists today. The field is here so group threads can be
		// added without a migration.
		type: { type: String, enum: ["direct"], default: "direct" },
		// "<Kind>:<id>|<Kind>:<id>", sorted — one thread per pair, enforced by
		// the unique index below.
		directKey: { type: String, required: true },
		participants: { type: [participantSchema], required: true },
		lastMessage: {
			type: new mongoose.Schema(
				{
					// Lets mark-read notice a message that landed while it was running.
					id: { type: mongoose.Schema.Types.ObjectId, default: null },
					body: { type: String, default: "" },
					senderId: { type: mongoose.Schema.Types.ObjectId, default: null },
					at: { type: Date, default: null },
				},
				{ _id: false },
			),
			default: null,
		},
		lastMessageAt: { type: Date, default: null },
	},
	{ timestamps: true },
);

chatConversationSchema.index({ directKey: 1 }, { unique: true });
chatConversationSchema.index({ "participants.id": 1, lastMessageAt: -1 });

export type ChatConversationDocument = mongoose.InferSchemaType<
	typeof chatConversationSchema
>;

const ChatConversation =
	(mongoose.models
		.ChatConversation as mongoose.Model<ChatConversationDocument>) ||
	mongoose.model<ChatConversationDocument>(
		"ChatConversation",
		chatConversationSchema,
	);

export default ChatConversation;
