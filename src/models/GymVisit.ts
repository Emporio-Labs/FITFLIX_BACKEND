import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";

export const VISIT_TYPES = [
	"workout",
	"class",
	"consultation",
	"other",
] as const;

export type VisitType = (typeof VISIT_TYPES)[number];

const gymVisitSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		// Which branch they walked into.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		checkInAt: { type: Date, required: true, default: Date.now, index: true },
		checkOutAt: { type: Date, default: null },
		// Duration in minutes, computed on check-out. Denormalised so analytics
		// aggregations don't have to re-derive it from the two timestamps.
		durationMinutes: { type: Number, default: null },
		visitType: {
			type: String,
			enum: VISIT_TYPES,
			default: "workout",
			required: true,
		},
		notes: { type: String, default: null },
		// Staff accountability: who marked them in / out.
		checkedInByAdminId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
		checkedOutByAdminId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
	},
	{ timestamps: true },
);

// Members can visit multiple times per day — this compound index keeps
// per-member visit lookups (and "currently in" scans) fast.
gymVisitSchema.index({ userId: 1, checkInAt: -1 });
// Fast lookup for "who is still inside" — checkOutAt is null while active.
gymVisitSchema.index({ checkOutAt: 1, checkInAt: -1 });
// Per-branch traffic: "who is in this club now" and daily footfall.
gymVisitSchema.index({ locationId: 1, checkInAt: -1 });

applyIdTransform(gymVisitSchema);

type GymVisitDocument = mongoose.InferSchemaType<typeof gymVisitSchema>;

export default (mongoose.models.GymVisit as mongoose.Model<GymVisitDocument>) ||
	mongoose.model<GymVisitDocument>("GymVisit", gymVisitSchema);
