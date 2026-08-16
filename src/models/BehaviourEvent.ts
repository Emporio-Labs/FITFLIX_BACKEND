import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

/**
 * What a member did in the app, kept only so a salesperson can walk into a
 * call knowing what the person was actually looking at.
 *
 * Deliberately not general-purpose analytics. Aggregate funnel questions are
 * answered by Firebase; this collection exists for the one thing Firebase is
 * bad at — telling you, per person, right now, what to talk about. Keeping the
 * purpose narrow is also what keeps the retention window short and the consent
 * story honest.
 *
 * Nothing lands here without a consent check upstream (utils/activity-consent),
 * and nothing lands here for a minor at all. See that module for why.
 */

export const BEHAVIOUR_EVENTS = [
	"screen_view",
	"cta_tap",
	"catalog_item_view",
	"mtm_join_tap",
	"plan_view",
	"consult_tap",
	"signup_start",
	"signup_complete",
] as const;

export type BehaviourEventName = (typeof BEHAVIOUR_EVENTS)[number];

/**
 * 180 days. Long enough that a slow-burn lead still has a story attached,
 * short enough that this never becomes a permanent behavioural dossier —
 * which is both the DPDP-friendly position and the one that keeps the
 * collection small enough to aggregate cheaply.
 */
export const BEHAVIOUR_EVENT_TTL_DAYS = 180;

const behaviourEventSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		event: { type: String, enum: BEHAVIOUR_EVENTS, required: true },
		/**
		 * Small, event-specific detail — a therapy id, a CTA id, the surface it
		 * was tapped on. Shape is validated at the API edge rather than here so
		 * new params never need a migration; size is capped there too, because
		 * an unbounded Mixed field is how this collection would quietly become
		 * the largest one in the database.
		 */
		params: { type: mongoose.Schema.Types.Mixed, default: {} },
		// Client-supplied: when it actually happened, not when the batch landed.
		// Batching means those differ by minutes, and ordering by receipt time
		// would scramble the sequence a salesperson is trying to read.
		occurredAt: { type: Date, required: true },
		// Groups one app session's events without identifying a device.
		sessionId: { type: String, default: null, trim: true },
	},
	{ timestamps: { createdAt: true, updatedAt: false } },
);

// The summary read: one user's recent activity, newest first.
behaviourEventSchema.index({ userId: 1, occurredAt: -1 });
// Retention. Mongo's TTL monitor sweeps roughly every 60s.
behaviourEventSchema.index(
	{ occurredAt: 1 },
	{ expireAfterSeconds: BEHAVIOUR_EVENT_TTL_DAYS * 24 * 60 * 60 },
);

applyIdTransform(behaviourEventSchema);

type BehaviourEventDocument = mongoose.InferSchemaType<
	typeof behaviourEventSchema
>;

export default (mongoose.models
	.BehaviourEvent as mongoose.Model<BehaviourEventDocument>) ||
	mongoose.model<BehaviourEventDocument>(
		"BehaviourEvent",
		behaviourEventSchema,
	);
