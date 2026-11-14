import mongoose from "mongoose";
import { CHAT_PARTICIPANT_KINDS } from "./ChatConversation";

export const CHAT_MESSAGE_MAX_LENGTH = 4000;

const chatMessageSchema = new mongoose.Schema(
	{
		conversationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ChatConversation",
			required: true,
		},
		senderKind: { type: String, enum: CHAT_PARTICIPANT_KINDS, required: true },
		senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
		// Snapshot at write time: roles and names change, what was said as whom
		// must not.
		senderRole: { type: String, required: true },
		senderName: { type: String, default: "" },
		body: { type: String, default: "", maxlength: CHAT_MESSAGE_MAX_LENGTH },
		kind: {
			type: String,
			enum: [
				"text",
				"image",
				"video",
				"audio",
				"activity_card",
				"exercise_share",
			],
			default: "text",
		},
		payload: {
			type: mongoose.Schema.Types.Mixed,
			default: undefined,
		},
		media: {
			type: new mongoose.Schema(
				{
					s3Key: { type: String, required: true },
					url: { type: String, required: true },
					thumbnailUrl: { type: String, default: undefined },
					mimeType: { type: String, required: true },
					byteSize: { type: Number, required: true },
					durationSeconds: { type: Number, default: undefined },
					width: { type: Number, default: undefined },
					height: { type: Number, default: undefined },
				},
				{ _id: false },
			),
			default: undefined,
		},
		reactions: {
			type: [
				{
					userId: { type: mongoose.Schema.Types.ObjectId, required: true },
					senderKind: {
						type: String,
						enum: CHAT_PARTICIPANT_KINDS,
						required: true,
					},
					reaction: { type: String, required: true },
					reactedAt: { type: Date, default: Date.now },
				},
			],
			default: [],
		},
		// Client-generated id for the optimistic bubble. A retried POST with the
		// same id returns the stored message instead of a duplicate.
		clientMessageId: { type: String, default: undefined },
		// Soft delete: the row stays so the thread keeps its shape and a report
		// can still point at it, but the text is wiped.
		deletedAt: { type: Date, default: null },
		deletedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
	},
	{ timestamps: true },
);

chatMessageSchema.index({ conversationId: 1, _id: -1 });
chatMessageSchema.index(
	{ conversationId: 1, senderId: 1, clientMessageId: 1 },
	{
		unique: true,
		partialFilterExpression: { clientMessageId: { $type: "string" } },
	},
);

export type ChatMessageDocument = mongoose.InferSchemaType<
	typeof chatMessageSchema
>;

const ChatMessage =
	(mongoose.models.ChatMessage as mongoose.Model<ChatMessageDocument>) ||
	mongoose.model<ChatMessageDocument>("ChatMessage", chatMessageSchema);

export default ChatMessage;
