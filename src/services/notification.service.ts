import { NotificationChannel, NotificationKind } from "../models/Enums";
import Notification from "../models/Notification";
import { sendPushToUser } from "./fcm.service";
import {
	emitToFrontDesk,
	emitToNutritionist,
	emitToUser,
	type FrontDeskEvent,
	type NutritionistEvent,
	type UserEvent,
} from "./realtime.service";

export { NotificationChannel, NotificationKind };

export interface NotifyPayload {
	userId: string;
	kind: NotificationKind;
	title: string;
	body: string;
	data?: Record<string, unknown>;
	channels?: NotificationChannel[];
}

/** Send a notification through one or more channels. All failures are non-fatal. */
export async function notify(payload: NotifyPayload): Promise<void> {
	const channels = payload.channels ?? [NotificationChannel.InApp];
	const stringData = payload.data
		? Object.fromEntries(
				Object.entries(payload.data).map(([k, v]) => [k, String(v)]),
			)
		: undefined;

	// In-app persistence
	if (channels.includes(NotificationChannel.InApp)) {
		try {
			await Notification.create({
				userId: payload.userId,
				kind: payload.kind,
				title: payload.title,
				body: payload.body,
				data: payload.data,
				channels,
				deliveredAt: new Date(),
			});
		} catch (err) {
			console.error("[notify] Failed to persist Notification", err);
		}
	}

	// Socket realtime
	if (channels.includes(NotificationChannel.Socket)) {
		try {
			emitToUser(payload.userId, mapKindToUserEvent(payload.kind), {
				...payload.data,
				title: payload.title,
				body: payload.body,
			});
		} catch (err) {
			console.error("[notify] Socket emit failed", err);
		}
	}

	// FCM push
	if (channels.includes(NotificationChannel.Push)) {
		sendPushToUser(payload.userId, {
			title: payload.title,
			body: payload.body,
			data: stringData,
		}).catch((err) => console.error("[notify] FCM push failed", err));
	}
}

function mapKindToUserEvent(kind: NotificationKind): UserEvent {
	const map: Record<NotificationKind, UserEvent> = {
		[NotificationKind.AppointmentBooked]: "appointment_booked",
		[NotificationKind.AppointmentRescheduled]: "appointment_rescheduled",
		[NotificationKind.AppointmentCancelled]: "appointment_cancelled",
		[NotificationKind.AppointmentReminder]: "appointment_reminder",
		[NotificationKind.OnboardingStepUpdated]: "onboarding_step_updated",
		[NotificationKind.MembershipExpiryReminder]: "membership_expiry_reminder",
		[NotificationKind.CommunityPostLiked]: "community_post_liked",
		[NotificationKind.CommunityPostCommented]: "community_post_commented",
		[NotificationKind.CommunityCommentReplied]: "community_comment_replied",
	};
	return map[kind];
}

/** Fan-out to FrontDesk and optionally a nutritionist room. */
export function fanOutToAdmin(
	event: FrontDeskEvent,
	data: unknown,
	nutritionistId?: string,
): void {
	try {
		emitToFrontDesk(event, data);
	} catch (err) {
		console.error("[fanOutToAdmin] FrontDesk emit failed", err);
	}

	if (nutritionistId) {
		try {
			emitToNutritionist(
				nutritionistId,
				"appointment_added" as NutritionistEvent,
				data,
			);
		} catch (err) {
			console.error("[fanOutToAdmin] Nutritionist emit failed", err);
		}
	}
}
