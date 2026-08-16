import mongoose from "mongoose";

const scheduledSessionSchema = new mongoose.Schema(
	{
		classId: {
			type: String,
			ref: "Class",
			required: true,
		},
		trainerId: {
			type: String,
			ref: "Trainer",
			default: null,
		},
		sessionDate: {
			type: Date,
			required: true,
		},
		startTime: {
			type: String,
			required: true,
		},
		endTime: {
			type: String,
			required: true,
		},
		deliveryType: {
			type: String,
			enum: ["ONLINE", "OFFLINE", "HYBRID"],
			default: "OFFLINE",
			required: true,
		},
		locationAddress: {
			type: String,
			default: null,
		},
		capacity: {
			type: Number,
			default: 20,
			min: 1,
			required: true,
		},
		currentBookings: {
			type: Number,
			default: 0,
			min: 0,
			required: true,
		},
		remainingCapacity: {
			type: Number,
			default: 20,
			min: 0,
			required: true,
		},
		status: {
			type: String,
			enum: ["SCHEDULED", "FULL", "CANCELLED", "COMPLETED"],
			default: "SCHEDULED",
			required: true,
		},
		recurrenceRule: {
			type: String,
			enum: ["NONE", "DAILY", "WEEKLY"],
			default: "NONE",
			required: true,
		},
		// A Zego *layout template* copied down from the parent class
		// ("interactive_class" | "large_event" | "standard_meeting") — NOT a room
		// identifier, despite the name. It must never take part in resolving a
		// room; see resolveSessionRoomId in utils/zego-room.ts.
		streamRoomId: {
			type: String,
			default: null,
		},
		// The one and only room identity for this occurrence. Stamped by the
		// lifecycle job at (start - lead); readers fall back to deriveRoomId(_id),
		// which produces the identical value.
		videoRoomId: {
			type: String,
			default: null,
		},
		// Room lifecycle, tracked separately from `status` because a room outlives
		// the class by the expiry grace: the session reads as over while hosts and
		// members are both still able to rejoin a READY room during overrun.
		roomStatus: {
			type: String,
			enum: ["PENDING", "READY", "EXPIRED"],
			default: "PENDING",
			required: true,
		},
		roomReadyAt: {
			type: Date,
			default: null,
		},
		roomExpiresAt: {
			type: Date,
			default: null,
		},
		// First confirmed instant the host was actually present in the room —
		// either self-reported (POST .../host-presence) or discovered by the
		// lifecycle sweep's Zego room-membership check. Write-once: never
		// cleared once set, even if the host later disconnects, so a flaky host
		// connection mid-class does not eject the members already admitted.
		// A member's join is gated on this being non-null (see
		// session-access.service.ts's HOST_NOT_STARTED check).
		hostLiveAt: {
			type: Date,
			default: null,
		},
		// Most recent host presence confirmation, from either source above.
		// Diagnostics only — nothing gates on this field.
		hostLastSeenAt: {
			type: Date,
			default: null,
		},
		isPublished: {
			type: Boolean,
			default: true,
			required: true,
		},
		// Set only by the host-initiated /zego/sessions/:id/end flow — lets a
		// member's "class ended" UI distinguish an early host-ended class from
		// one that simply ran to its scheduled end time.
		endedAt: {
			type: Date,
			default: null,
		},
		endedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

// The lifecycle sweep scans by room state within a narrow date band every
// minute; without this it degrades to a full collection scan as history grows.
scheduledSessionSchema.index({ roomStatus: 1, sessionDate: 1 });
scheduledSessionSchema.index({ roomStatus: 1, roomExpiresAt: 1 });
// The host-presence verification sweep scans exactly this pair: READY rooms
// that haven't confirmed a host yet.
scheduledSessionSchema.index({ roomStatus: 1, hostLiveAt: 1 });

type ScheduledSessionDocument = mongoose.InferSchemaType<
	typeof scheduledSessionSchema
>;

export default (mongoose.models.ScheduledSession as mongoose.Model<ScheduledSessionDocument>) ||
	mongoose.model<ScheduledSessionDocument>(
		"ScheduledSession",
		scheduledSessionSchema,
	);
