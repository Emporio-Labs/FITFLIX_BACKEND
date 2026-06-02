Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var Enums_1 = require("./Enums");
var notificationSchema = new mongoose_1.default.Schema(
	{
		userId: {
			type: mongoose_1.default.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		kind: {
			type: String,
			enum: Object.values(Enums_1.NotificationKind),
			required: true,
		},
		title: { type: String, required: true },
		body: { type: String, required: true },
		// Arbitrary JSON data for the client (e.g. appointmentId, expertType)
		data: { type: mongoose_1.default.Schema.Types.Mixed, default: undefined },
		channels: {
			type: [String],
			enum: Object.values(Enums_1.NotificationChannel),
			default: [Enums_1.NotificationChannel.InApp],
		},
		readAt: { type: Date, default: undefined },
		deliveredAt: { type: Date, default: undefined },
	},
	{ timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
exports.default =
	mongoose_1.default.models.Notification ||
	mongoose_1.default.model("Notification", notificationSchema);
