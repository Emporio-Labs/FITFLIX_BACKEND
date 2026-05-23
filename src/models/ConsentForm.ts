import mongoose from "mongoose";
import { ConsentType } from "./Enums";

const consentEntrySchema = new mongoose.Schema(
	{
		type: {
			type: String,
			enum: Object.values(ConsentType),
			required: true,
		},
		accepted: { type: Boolean, required: true },
		acceptedAt: { type: Date, required: true },
		signatureName: { type: String, default: undefined },
		dateSigned: { type: Date, default: undefined },
		pdfUrl: { type: String, default: undefined },
		signatureUrl: { type: String, default: undefined },
	},
	{ _id: false },
);

const consentFormSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		consents: { type: [consentEntrySchema], default: [] },
		ipAddress: { type: String, default: undefined },
		deviceInfo: { type: String, default: undefined },
	},
	{ timestamps: true },
);

type ConsentFormDocument = mongoose.InferSchemaType<typeof consentFormSchema>;

export default (mongoose.models.ConsentForm as mongoose.Model<ConsentFormDocument>) ||
	mongoose.model<ConsentFormDocument>("ConsentForm", consentFormSchema);
