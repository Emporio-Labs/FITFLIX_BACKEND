import { z } from "zod";
import {
	NotificationDeliveryMode,
	WorkoutNotificationFrequency,
} from "../models/Enums";

const timeStringSchema = z
	.string()
	.regex(
		/^([01]\d|2[0-3]):([0-5]\d)$/,
		"Time must be in HH:mm 24-hour format (00:00 - 23:59)",
	);

const deliveryModeSchema = z.nativeEnum(NotificationDeliveryMode);
const workoutFrequencySchema = z.nativeEnum(WorkoutNotificationFrequency);

export const updateNotificationPreferencesSchema = z.object({
	masterPushEnabled: z.boolean().optional(),
	coachMessages: z
		.object({
			directMessages: deliveryModeSchema.optional(),
			feedbackAndComments: deliveryModeSchema.optional(),
		})
		.optional(),
	appointments: z
		.object({
			sessionUpdates: deliveryModeSchema.optional(),
			reminderLeadMinutes: z.number().int().min(0).max(2880).optional(),
			waitlistAlerts: deliveryModeSchema.optional(),
		})
		.optional(),
	workouts: z
		.object({
			completionMode: deliveryModeSchema.optional(),
			completionFrequency: workoutFrequencySchema.optional(),
			milestonesAndPrs: deliveryModeSchema.optional(),
			bcaScanSynced: deliveryModeSchema.optional(),
		})
		.optional(),
	habits: z
		.object({
			weighInReminderEnabled: z.boolean().optional(),
			weighInTime: timeStringSchema.optional(),
			waterNudgesEnabled: z.boolean().optional(),
		})
		.optional(),
	community: z
		.object({
			repliesAndMentions: deliveryModeSchema.optional(),
			cheersAndLikes: deliveryModeSchema.optional(),
		})
		.optional(),
	quietHours: z
		.object({
			enabled: z.boolean().optional(),
			startTime: timeStringSchema.optional(),
			endTime: timeStringSchema.optional(),
		})
		.optional(),
});

export type UpdateNotificationPreferencesInput = z.infer<
	typeof updateNotificationPreferencesSchema
>;
