import mongoose from "mongoose";
import { MedicalReportCategory, MedicalReportSource } from "./Enums";

const medicalReportSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		reportName: { type: String, required: true },
		reportType: { type: String, required: true },
		reportUrl: { type: String, default: undefined },
		s3Key: { type: String, default: undefined },
		mimeType: { type: String, default: undefined },
		fileSize: { type: Number, default: undefined },
		uploadedAt: { type: Date, default: () => new Date() },
		// "dna" is only ever set by the front-desk DNA upload route; a member's
		// own upload is always "medical", whatever they typed in reportType.
		// Records from before these fields existed read as medical / client.
		category: {
			type: String,
			enum: Object.values(MedicalReportCategory),
			default: MedicalReportCategory.Medical,
		},
		source: {
			type: String,
			enum: Object.values(MedicalReportSource),
			default: MedicalReportSource.Client,
		},
		// Who uploaded it. The member themselves for a client upload, the staff
		// account for a front-desk one — no ref because staff live in other
		// collections (Admin, FrontDesk).
		uploadedBy: { type: mongoose.Schema.Types.ObjectId, default: undefined },
		uploadedByRole: { type: String, default: undefined },
	},
	{ timestamps: true },
);

medicalReportSchema.index({ userId: 1, category: 1, uploadedAt: -1 });

type MedicalReportDocument = mongoose.InferSchemaType<
	typeof medicalReportSchema
>;

export default (mongoose.models
	.MedicalReport as mongoose.Model<MedicalReportDocument>) ||
	mongoose.model<MedicalReportDocument>("MedicalReport", medicalReportSchema);
