import mongoose from "mongoose";

const therapySchema = new mongoose.Schema(
	{
		therapyName: { type: String, required: true },
		therapyTime: { type: Number, required: true },
		description: { type: String, required: true },
		tags: { type: [String], default: [] },
		slots: [
			{
				type: mongoose.Schema.Types.ObjectId,
				ref: "Slot",
				required: true,
			},
		],
		// Branch this record belongs to. Null = company-wide / online.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
	},
	{ timestamps: true },
);

therapySchema.index({ locationId: 1 });

export default (mongoose.models.Therapy as mongoose.Model<any>) ||
	mongoose.model("Therapy", therapySchema);
