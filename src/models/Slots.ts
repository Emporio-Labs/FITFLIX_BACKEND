import mongoose from "mongoose";

const slotSchema = new mongoose.Schema(
	{
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

slotSchema.index(
	{ parentTemplate: 1, date: 1, startTime: 1, endTime: 1 },
	{
		unique: true,
		partialFilterExpression: { parentTemplate: { $exists: true, $ne: null } },
	},
);

export default (mongoose.models.Slot as mongoose.Model<any>) ||
	mongoose.model("Slot", slotSchema);
