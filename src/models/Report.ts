import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { ReportStatus, ReportTargetType } from "./Enums";

const reportSchema = new mongoose.Schema(
	{
		reporterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		targetType: {
			type: String,
			enum: Object.values(ReportTargetType),
			required: true,
		},
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
		},
		reason: { type: String, required: true },
		note: { type: String, default: "" },
		status: {
			type: String,
			enum: Object.values(ReportStatus),
			default: ReportStatus.Pending,
			required: true,
		},
	},
	{ timestamps: true },
);

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ targetType: 1, targetId: 1 });
// One OPEN (pending) report per user per target — enforced at the DB so a
// duplicate report is idempotent, not a second row.
reportSchema.index(
	{ reporterId: 1, targetType: 1, targetId: 1 },
	{
		unique: true,
		partialFilterExpression: { status: ReportStatus.Pending },
	},
);

applyIdTransform(reportSchema);

export type ReportDocument = mongoose.InferSchemaType<typeof reportSchema>;

const Report =
	(mongoose.models.Report as mongoose.Model<ReportDocument>) ||
	mongoose.model<ReportDocument>("Report", reportSchema);

export default Report;
