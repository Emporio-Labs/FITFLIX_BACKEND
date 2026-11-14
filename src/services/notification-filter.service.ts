import {
	NotificationDeliveryMode,
	NotificationKind,
	WorkoutNotificationFrequency,
} from "../models/Enums";
import NotificationPreferences from "../models/NotificationPreferences";

export interface DeliveryDecision {
	shouldPush: boolean;
	shouldInApp: boolean;
	reason: string;
}

/**
 * Checks whether a given minute-of-day falls within the quiet hours window.
 * Times are "HH:mm" in 24-hour format.
 */
export function isQuietHoursNow(
	startTime: string,
	endTime: string,
	currentMinutesOverride?: number,
): boolean {
	const parseMinutes = (t: string) => {
		const [h, m] = t.split(":").map(Number);
		return (h ?? 0) * 60 + (m ?? 0);
	};

	const start = parseMinutes(startTime);
	const end = parseMinutes(endTime);

	let currentMinutes = currentMinutesOverride;
	if (currentMinutes === undefined) {
		// Convert current server time to Asia/Kolkata (IST)
		const istStr = new Date().toLocaleString("en-US", {
			timeZone: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
		});
		const [h, m] = istStr.split(":").map(Number);
		currentMinutes = (h ?? 0) * 60 + (m ?? 0);
	}

	if (start === end) {
		return false;
	}

	if (start < end) {
		// e.g. 01:00 to 06:00
		return currentMinutes >= start && currentMinutes < end;
	}

	// Crosses midnight, e.g. 22:00 to 07:00
	return currentMinutes >= start || currentMinutes < end;
}

const TRANSACTIONAL_KINDS = new Set<NotificationKind>([
	NotificationKind.AppointmentCancelled,
	NotificationKind.AppointmentRescheduled,
	NotificationKind.WaitlistPromoted,
]);

/**
 * Determines whether a notification should be dispatched via Push and/or persisted In-App
 * according to the user's notification preferences and quiet hours.
 */
export async function resolveNotificationDelivery(
	userId: string,
	kind: NotificationKind,
	metadata?: {
		isMilestone?: boolean;
		isPR?: boolean;
		isTransactional?: boolean;
		nowMinutes?: number;
	},
): Promise<DeliveryDecision> {
	// 1. Transactional override: Cancellations, emergency updates, payment alerts always deliver
	if (metadata?.isTransactional || TRANSACTIONAL_KINDS.has(kind)) {
		return {
			shouldPush: true,
			shouldInApp: true,
			reason: "transactional_override",
		};
	}

	// 2. Fetch user preferences, or use defaults
	const prefs = await NotificationPreferences.findOne({ userId }).lean();

	// If no preferences record exists, defaults are all "both" + quiet hours active
	const masterPushEnabled = prefs?.masterPushEnabled ?? true;
	const quietHours = prefs?.quietHours ?? {
		enabled: true,
		startTime: "22:00",
		endTime: "07:00",
	};

	// 3. Master push toggle
	if (!masterPushEnabled) {
		return {
			shouldPush: false,
			shouldInApp: true,
			reason: "master_push_disabled",
		};
	}

	// 4. Quiet hours filter (silences push, preserves in-app)
	if (
		quietHours.enabled &&
		isQuietHoursNow(quietHours.startTime, quietHours.endTime, metadata?.nowMinutes)
	) {
		return {
			shouldPush: false,
			shouldInApp: true,
			reason: "quiet_hours_active",
		};
	}

	// 5. Category-specific delivery mode
	let mode: string = NotificationDeliveryMode.Both;

	switch (kind) {
		case NotificationKind.CoachMessage:
			mode = prefs?.coachMessages?.directMessages ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.CoachFeedback:
			mode =
				prefs?.coachMessages?.feedbackAndComments ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.AppointmentBooked:
		case NotificationKind.AppointmentReminder:
			mode = prefs?.appointments?.sessionUpdates ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.WaitlistSkippedInsufficientCredits:
			mode = prefs?.appointments?.waitlistAlerts ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.WorkoutCompleted: {
			mode = prefs?.workouts?.completionMode ?? NotificationDeliveryMode.Both;
			const freq =
				prefs?.workouts?.completionFrequency ??
				WorkoutNotificationFrequency.MilestoneOnly;
			if (freq === WorkoutNotificationFrequency.None) {
				mode = NotificationDeliveryMode.None;
			} else if (
				freq === WorkoutNotificationFrequency.MilestoneOnly &&
				!metadata?.isMilestone &&
				!metadata?.isPR
			) {
				return {
					shouldPush: false,
					shouldInApp: true,
					reason: "workout_routine_filtered",
				};
			}
			break;
		}
		case NotificationKind.GoalMilestone:
			mode = prefs?.workouts?.milestonesAndPrs ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.BcaScanSynced:
			mode = prefs?.workouts?.bcaScanSynced ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.CommunityPostCommented:
		case NotificationKind.CommunityCommentReplied:
			mode =
				prefs?.community?.repliesAndMentions ?? NotificationDeliveryMode.Both;
			break;
		case NotificationKind.CommunityPostLiked:
			mode =
				prefs?.community?.cheersAndLikes ?? NotificationDeliveryMode.InApp;
			break;
		case NotificationKind.SystemTest:
			mode = NotificationDeliveryMode.Both;
			break;
		default:
			mode = NotificationDeliveryMode.Both;
			break;
	}

	if (mode === NotificationDeliveryMode.None) {
		return {
			shouldPush: false,
			shouldInApp: false,
			reason: "category_muted",
		};
	}

	if (mode === NotificationDeliveryMode.InApp) {
		return {
			shouldPush: false,
			shouldInApp: true,
			reason: "in_app_only",
		};
	}

	return {
		shouldPush: true,
		shouldInApp: true,
		reason: "allowed",
	};
}
