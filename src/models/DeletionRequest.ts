import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { DeletionRequestStatus } from "./Enums";

const deletionRequestSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: undefined,
		},
		fullName: {
			type: String,
			required: true,
			trim: true,
		},
		email: {
			type: String,
			trim: true,
			lowercase: true,
			default: undefined,
		},
		phone: {
			type: String,
			trim: true,
			default: undefined,
		},
		reason: {
			type: String,
			trim: true,
			default: "",
		},
		status: {
			type: String,
			enum: Object.values(DeletionRequestStatus),
			default: DeletionRequestStatus.Pending,
			required: true,
		},
		ipAddress: {
			type: String,
			default: "",
		},
		userAgent: {
			type: String,
			default: "",
		},
	},
	{ timestamps: true },
);

applyIdTransform(deletionRequestSchema);

type DeletionRequestDocument = mongoose.InferSchemaType<typeof deletionRequestSchema>;

export default (mongoose.models.DeletionRequest as mongoose.Model<DeletionRequestDocument>) ||
	mongoose.model<DeletionRequestDocument>("DeletionRequest", deletionRequestSchema);
