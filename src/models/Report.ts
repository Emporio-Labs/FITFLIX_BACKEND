import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ReportStatus } from "./Enums";

const reportSchema = new mongoose.Schema(
	{
		reporterId: {
			type: mongoose.Schema.Types.ObjectId,
			default: null,
		},
		targetType: {
			type: String,
			enum: ["post", "comment", "user"],
			required: true,
		},
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		reason: { type: String, required: true, maxlength: 500 },
		note: { type: String, default: "" },
		status: {
			type: String,
			enum: Object.values(ReportStatus),
			default: ReportStatus.Pending,
		},
		// Incremented when multiple users report the same content
		reportCount: { type: Number, default: 1, min: 1 },
		resolvedAt: { type: Date, default: null },
		resolvedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
	},
	{ timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });

applyIdTransform(reportSchema);

export type ReportDocument = mongoose.InferSchemaType<typeof reportSchema>;

const Report =
	(mongoose.models.Report as mongoose.Model<ReportDocument>) ||
	mongoose.model<ReportDocument>("Report", reportSchema);

export default Report;
