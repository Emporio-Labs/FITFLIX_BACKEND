import mongoose from "mongoose";

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
		uploadedAt: { type: Date, default: () => new Date() },
	},
	{ timestamps: true },
);

type MedicalReportDocument = mongoose.InferSchemaType<
	typeof medicalReportSchema
>;

export default (mongoose.models.MedicalReport as mongoose.Model<MedicalReportDocument>) ||
	mongoose.model<MedicalReportDocument>("MedicalReport", medicalReportSchema);
