import mongoose from "mongoose";

const consentFormSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},
		accepted: { type: Boolean, required: true },
		acceptedAt: { type: Date, required: true },
		signatureUrl: { type: String, default: undefined },
		ipAddress: { type: String, default: undefined },
	},
	{ timestamps: true },
);

type ConsentFormDocument = mongoose.InferSchemaType<typeof consentFormSchema>;

export default (mongoose.models.ConsentForm as mongoose.Model<ConsentFormDocument>) ||
	mongoose.model<ConsentFormDocument>("ConsentForm", consentFormSchema);
