import mongoose from "mongoose";

const classSchema = new mongoose.Schema(
	{
		name: { type: String, required: true },
		description: { type: String, required: true },
		dateTime: { type: Date, required: true },
		duration: { type: Number, required: true }, // in minutes
		creditsCost: { type: Number, required: true },
		scheduleType: {
			type: String,
			enum: ["FIXED", "RECURRING"],
			required: true,
		},
		trainer: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			required: true,
		},
		capacity: { type: Number, required: true },
		classType: {
			type: String,
			enum: ["online", "offline"],
			required: true,
		},
		location: { type: String, default: undefined }, // physical address for offline classes
		meetingUrl: { type: String, default: undefined }, // online meeting URL
		meetingPasscode: { type: String, default: undefined }, // online meeting passcode
	},
	{ timestamps: true },
);

type ClassDocument = mongoose.InferSchemaType<typeof classSchema>;

export default (mongoose.models.Class as mongoose.Model<ClassDocument>) ||
	mongoose.model<ClassDocument>("Class", classSchema);
