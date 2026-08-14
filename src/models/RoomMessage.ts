import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { applyAppendOnlyGuard } from "../utils/mongoose-append-only";

/**
 * Durable record of a Zego "Room messages" chat sent during a live
 * session (group class / live stream / nutritionist 1-on-1). Zego's own
 * room broadcast stays the live transport between participants; this
 * collection is only the source of truth for history — so a host who
 * exits and rejoins the same scheduled session, or a late joiner, can see
 * what was said before they connected.
 *
 * `sessionId` is a plain string (not ObjectId) because it doubles as the
 * key for the nutritionist 1-on-1 branch of resolveSessionAccess, whose
 * "session" id is a synthetic `nutri_session_<bookingId>` string rather
 * than a real ScheduledSession _id.
 */
const roomMessageSchema = new mongoose.Schema(
	{
		sessionId: { type: String, required: true },
		// Resolved Zego room id (resolveSessionRoomId) at send time — kept for
		// traceability only. Never used as the lookup key: it is derived
		// (`gc_<sessionId>`) and has a historical migration behind it, so the
		// scheduled-session id is the one stable identity.
		roomId: { type: String, required: true },
		senderUserId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		// Snapshot at write time, same rationale as Comment.authorRole — the
		// room's roster/roles can change after the fact, but who said what as
		// which role at the time must not.
		senderName: { type: String, required: true },
		senderRole: { type: String, enum: ["host", "member"], required: true },
		body: { type: String, required: true, maxlength: 2000 },
		// Dedup key from the client's Zego message (or a client-generated id for
		// the sender's own optimistic send) — lets a retried POST be a no-op
		// instead of a duplicate row.
		zegoMessageId: { type: String, default: null },
		// Client-reported send time (matches what the chat UI displays);
		// createdAt on the timestamps below is the authoritative server clock.
		sentAt: { type: Date, required: true },
	},
	{ timestamps: true },
);

roomMessageSchema.index({ sessionId: 1, sentAt: 1, _id: 1 });
roomMessageSchema.index(
	{ sessionId: 1, senderUserId: 1, zegoMessageId: 1 },
	{ unique: true, sparse: true },
);

applyIdTransform(roomMessageSchema);
applyAppendOnlyGuard(roomMessageSchema, "RoomMessage");

export type RoomMessageDocument = mongoose.InferSchemaType<
	typeof roomMessageSchema
>;

const RoomMessage =
	(mongoose.models.RoomMessage as mongoose.Model<RoomMessageDocument>) ||
	mongoose.model<RoomMessageDocument>("RoomMessage", roomMessageSchema);

export default RoomMessage;
