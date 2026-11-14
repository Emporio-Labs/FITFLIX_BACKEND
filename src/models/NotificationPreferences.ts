import mongoose from "mongoose";
import { NotificationDeliveryMode, WorkoutNotificationFrequency } from "./Enums";

const notificationPreferencesSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
			index: true,
		},
		masterPushEnabled: {
			type: Boolean,
			default: true,
		},
		coachMessages: {
			directMessages: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
			feedbackAndComments: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
		},
		appointments: {
			sessionUpdates: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
			reminderLeadMinutes: {
				type: Number,
				default: 60, // 1 hour before
			},
			waitlistAlerts: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
		},
		workouts: {
			completionMode: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
			completionFrequency: {
				type: String,
				enum: Object.values(WorkoutNotificationFrequency),
				default: WorkoutNotificationFrequency.MilestoneOnly,
			},
			milestonesAndPrs: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
			bcaScanSynced: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
		},
		habits: {
			weighInReminderEnabled: {
				type: Boolean,
				default: true,
			},
			weighInTime: {
				type: String,
				default: "07:30",
			},
			waterNudgesEnabled: {
				type: Boolean,
				default: true,
			},
		},
		community: {
			repliesAndMentions: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.Both,
			},
			cheersAndLikes: {
				type: String,
				enum: Object.values(NotificationDeliveryMode),
				default: NotificationDeliveryMode.InApp,
			},
		},
		quietHours: {
			enabled: {
				type: Boolean,
				default: true,
			},
			startTime: {
				type: String,
				default: "22:00",
			},
			endTime: {
				type: String,
				default: "07:00",
			},
		},
	},
	{ timestamps: true },
);

type NotificationPreferencesDocument = mongoose.InferSchemaType<
	typeof notificationPreferencesSchema
>;

export default (mongoose.models
	.NotificationPreferences as mongoose.Model<NotificationPreferencesDocument>) ||
	mongoose.model<NotificationPreferencesDocument>(
		"NotificationPreferences",
		notificationPreferencesSchema,
	);
