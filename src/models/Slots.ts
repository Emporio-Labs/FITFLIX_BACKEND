import mongoose from "mongoose";

import { ExpertType } from "./Enums";

const slotSchema = new mongoose.Schema(
	{
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		// Which expert/service this slot's inventory belongs to. Added
		// 2026-08-26 so the sports-scientist onboarding step can book against
		// its own capacity instead of draining the nutritionist pool — every
		// pre-existing row is backfilled to "nutritionist" (see
		// scripts/backfill-slot-expert-type.ts), since that was the only
		// consumer of /slots/available before this field existed.
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			default: ExpertType.Nutritionist,
			required: true,
			index: true,
		},
		date: { type: Date, required: false, default: null },
		isDaily: { type: Boolean, required: true, default: true },
		startTime: { type: String, required: true },
		endTime: { type: String, required: true },
		capacity: { type: Number, required: true, min: 1, default: 1 },
		remainingCapacity: { type: Number, required: true, min: 0, default: 1 },
		isBooked: { type: Boolean, required: true, default: false },
		parentTemplate: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Slot",
			required: false,
			default: null,
		},
	},
	{ timestamps: true },
);

slotSchema.index({ locationId: 1, date: 1, startTime: 1 });
slotSchema.index({ expertType: 1, isDaily: 1, date: 1, startTime: 1 });

slotSchema.index(
	{ parentTemplate: 1, date: 1, startTime: 1, endTime: 1 },
	{
		unique: true,
		partialFilterExpression: { parentTemplate: { $exists: true, $ne: null } },
	},
);

export default (mongoose.models.Slot as mongoose.Model<any>) ||
	mongoose.model("Slot", slotSchema);
