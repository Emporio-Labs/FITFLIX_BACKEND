import mongoose from "mongoose";
import { NotificationChannel, NotificationKind } from "./Enums";

const notificationSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		kind: {
			type: String,
			enum: Object.values(NotificationKind),
			required: true,
		},
		title: { type: String, required: true },
		body: { type: String, required: true },
		// Arbitrary JSON data for the client (e.g. appointmentId, expertType)
		data: { type: mongoose.Schema.Types.Mixed, default: undefined },
		channels: {
			type: [String],
			enum: Object.values(NotificationChannel),
			default: [NotificationChannel.InApp],
		},
		readAt: { type: Date, default: undefined },
		deliveredAt: { type: Date, default: undefined },
	},
	{ timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

type NotificationDocument = mongoose.InferSchemaType<typeof notificationSchema>;

export default (mongoose.models
	.Notification as mongoose.Model<NotificationDocument>) ||
	mongoose.model<NotificationDocument>("Notification", notificationSchema);
