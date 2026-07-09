import mongoose from "mongoose";

const trainerSchema = new mongoose.Schema(
	{
		trainerName: { type: String, required: true },
		email: { type: String, required: true, unique: true, sparse: true },
		phone: { type: String, required: true },
		passwordHash: { type: String, required: true, select: false },
		description: { type: String, default: "" },
		specialities: { type: [String], default: [] },
		imageUrl: { type: String, default: "" },
		keySentence: { type: String, default: "" },
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

export default (mongoose.models.Trainer as mongoose.Model<any>) ||
	mongoose.model("Trainer", trainerSchema);
