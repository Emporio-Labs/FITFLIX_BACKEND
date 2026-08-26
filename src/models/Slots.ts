import mongoose from "mongoose";

import { ExpertType, SlotResourceType } from "./Enums";
import { calculateDurationMinutes } from "../utils/time.util";

const slotSchema = new mongoose.Schema(
	{
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
			index: true,
		},
		// Universal Resource Type
		resourceType: {
			type: String,
			enum: Object.values(SlotResourceType),
			default: SlotResourceType.NUTRITIONIST,
			required: true,
			index: true,
		},
		// Optional specific resource (e.g. Therapy id, Service id, or Expert user id).
		// Null means shared pool for that resourceType.
		resourceId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
			index: true,
		},
		// Denormalized duration in minutes for fast query and sorting
		durationMinutes: {
			type: Number,
			required: false,
			min: 1,
		},
		// Legacy expertType field preserved for backward compatibility with existing callers.
		expertType: {
			type: String,
			enum: Object.values(ExpertType),
			default: ExpertType.Nutritionist,
			required: false,
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

slotSchema.pre("validate", function () {
	// Auto-compute durationMinutes if missing
	if (!this.durationMinutes && this.startTime && this.endTime) {
		const duration = calculateDurationMinutes(this.startTime, this.endTime);
		if (duration > 0) {
			this.durationMinutes = duration;
		}
	}

	// Two-way synchronization between resourceType and expertType
	if (this.resourceType === SlotResourceType.SPORTS_SCIENTIST) {
		this.expertType = ExpertType.SportsScientist;
	} else if (this.resourceType === SlotResourceType.NUTRITIONIST) {
		this.expertType = ExpertType.Nutritionist;
	} else if (
		this.expertType === ExpertType.SportsScientist &&
		(!this.resourceType || this.resourceType === SlotResourceType.NUTRITIONIST)
	) {
		this.resourceType = SlotResourceType.SPORTS_SCIENTIST;
	}
});

slotSchema.index({ locationId: 1, resourceType: 1, date: 1, startTime: 1 });
slotSchema.index({ locationId: 1, resourceType: 1, resourceId: 1, isDaily: 1, startTime: 1 });
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
