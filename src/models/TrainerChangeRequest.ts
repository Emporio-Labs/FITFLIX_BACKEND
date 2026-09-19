import mongoose from "mongoose";
import { applyIdTransform } from "../utils/mongoose-serialization";
import { TrainerChangeRequestStatus } from "./Enums";

const trainerChangeRequestSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		currentTrainerId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			default: null,
		},
		requestedTrainerId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Trainer",
			required: true,
		},
		reason: {
			type: String,
			required: true,
			trim: true,
		},
		status: {
			type: String,
			enum: Object.values(TrainerChangeRequestStatus),
			default: TrainerChangeRequestStatus.PENDING,
			required: true,
			index: true,
		},
		adminNotes: {
			type: String,
			default: "",
		},
		resolvedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		resolvedAt: {
			type: Date,
			default: null,
		},
		// Branch this record belongs to. Null = company-wide / online.
		locationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Location",
			default: null,
		},
	},
	{ timestamps: true },
);

trainerChangeRequestSchema.index({ locationId: 1, status: 1 });

applyIdTransform(trainerChangeRequestSchema);

type TrainerChangeRequestDocument = mongoose.InferSchemaType<
	typeof trainerChangeRequestSchema
>;

export default (mongoose.models
	.TrainerChangeRequest as mongoose.Model<TrainerChangeRequestDocument>) ||
	mongoose.model<TrainerChangeRequestDocument>(
		"TrainerChangeRequest",
		trainerChangeRequestSchema,
	);
