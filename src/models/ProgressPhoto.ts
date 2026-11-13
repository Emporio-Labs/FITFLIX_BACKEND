import mongoose from "mongoose";
import { PhotoPose } from "./Enums";

export { PhotoPose };

const progressPhotoSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		recordedDate: {
			type: Date,
			required: true,
			index: true,
		},
		capturedAt: {
			type: Date,
			required: true,
			default: Date.now,
		},
		pose: {
			type: String,
			enum: Object.values(PhotoPose),
			required: true,
		},
		s3Key: {
			type: String,
			required: true,
		},
		thumbnailKey: {
			type: String,
			required: true,
		},
		weightKg: {
			type: Number,
			default: undefined,
		},
		notes: {
			type: String,
			trim: true,
			maxlength: 500,
			default: undefined,
		},
		isPrivateToSelf: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true, collection: "progress_photos" },
);

// Compound index for chronological querying by user and pose
progressPhotoSchema.index({ userId: 1, recordedDate: -1, pose: 1 });
// Enforce unique pose per day per user
progressPhotoSchema.index({ userId: 1, recordedDate: 1, pose: 1 }, { unique: true });

type ProgressPhotoDocument = mongoose.InferSchemaType<typeof progressPhotoSchema>;

export default (mongoose.models.ProgressPhoto as mongoose.Model<ProgressPhotoDocument>) ||
	mongoose.model<ProgressPhotoDocument>("ProgressPhoto", progressPhotoSchema);
