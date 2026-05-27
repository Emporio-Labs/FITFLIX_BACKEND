import mongoose from "mongoose";
import { LeadStatus } from "./Enums";

const leadSchema = new mongoose.Schema(
	{
		leadName: { type: String, required: true },
		email: { type: String, required: true },
		phone: { type: String, default: "" },
		source: { type: String, default: "" },
		status: {
			type: String,
			enum: Object.values(LeadStatus),
			default: LeadStatus.New,
			required: true,
		},
		interestedIn: { type: String, default: "" },
		notes: { type: String, default: "" },
		tags: { type: [String], default: [] },
		publicCapture: { type: mongoose.Schema.Types.Mixed, default: null },
		followUpDate: { type: Date, default: null },
		owner: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
		convertedUser: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

type LeadDocument = mongoose.InferSchemaType<typeof leadSchema>;

export default (mongoose.models.Lead as mongoose.Model<LeadDocument>) ||
	mongoose.model<LeadDocument>("Lead", leadSchema);
