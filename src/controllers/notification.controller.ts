import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { NotificationChannel, NotificationKind } from "../models/Enums";
import Notification from "../models/Notification";
import NotificationPreferences from "../models/NotificationPreferences";
import { isAllowedTopic, registerFcmToken, sendPushToTopic } from "../services/fcm.service";
import { notify } from "../services/notification.service";
import {
	getVapidPublicKey,
	listPushSubscriptions,
	registerPushSubscription,
	sendWebPushToUser,
	unregisterPushSubscription,
	updatePushPreferences,
} from "../services/webpush.service";
import type { AuthenticatedUser } from "../types/auth";
import { updateNotificationPreferencesSchema } from "../validators/notification-preferences.validator";

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		details[field] = issue.message;
	}
	return details;
};

const getIdParam = (v: unknown): string | null => {
	if (typeof v !== "string" || !mongoose.Types.ObjectId.isValid(v)) return null;
	return v;
};

export const listNotifications: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		const page = Math.max(1, Number(req.query.page ?? 1));
		const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)));
		const skip = (page - 1) * limit;

		const [notifications, total, unread] = await Promise.all([
			Notification.find({ userId: user.id })
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.lean(),
			Notification.countDocuments({ userId: user.id }),
			Notification.countDocuments({ userId: user.id, readAt: null }),
		]);

		res.status(200).json({
			notifications,
			unread,
			pagination: { total, page, limit, pages: Math.ceil(total / limit) },
		});
	} catch (err) {
		next(err);
	}
};

export const markNotificationRead: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res
			.status(400)
			.json({ error: "Invalid notification ID", code: "BAD_REQUEST" });
		return;
	}

	try {
		const notification = await Notification.findOneAndUpdate(
			{ _id: id, userId: user.id },
			{ $set: { readAt: new Date() } },
			{ returnDocument: "after" },
		);

		if (!notification) {
			res
				.status(404)
				.json({ error: "Notification not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ notification });
	} catch (err) {
		next(err);
	}
};

export const markAllRead: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		await Notification.updateMany(
			{ userId: user.id, readAt: null },
			{ $set: { readAt: new Date() } },
		);
		res.status(200).json({ message: "All notifications marked as read" });
	} catch (err) {
		next(err);
	}
};

export const registerToken: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const { token, platform } = req.body as { token?: string; platform?: string };
	if (!token || !platform || !["ios", "android"].includes(platform)) {
		res.status(400).json({
			error: "token and platform (ios|android) are required",
			code: "VALIDATION_ERROR",
		});
		return;
	}

	try {
		await registerFcmToken(user.id, token, platform as "ios" | "android");
		res.status(200).json({ message: "FCM token registered" });
	} catch (err) {
		next(err);
	}
};

// -----------------------------------------------------------------------------
// FX-25 · Web Push (VAPID) endpoints for the staff PWA (frontdesk-fitflix).
// -----------------------------------------------------------------------------

export const getWebPushVapidKey: RequestHandler = (_req, res) => {
	const publicKey = getVapidPublicKey();
	if (!publicKey) {
		res.status(503).json({
			error: "Web Push not configured on this server",
			code: "WEB_PUSH_DISABLED",
		});
		return;
	}
	res.status(200).json({ publicKey });
};

export const listMyWebPushSubscriptions: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}
	try {
		const subs = await listPushSubscriptions(user.id);
		const devices = subs.map((s) => ({
			id: s.endpoint, // stable id — endpoint is unique per install
			endpoint: s.endpoint,
			deviceLabel: s.ua,
			role: s.role,
			createdAt: s.createdAt,
			lastNotifiedAt: s.lastNotifiedAt,
			preferences: s.preferences,
		}));
		res.status(200).json({ devices });
	} catch (err) {
		next(err);
	}
};

export const registerWebPushSubscription: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}
	const body = req.body as {
		subscription?: {
			endpoint?: string;
			keys?: { p256dh?: string; auth?: string };
		};
		role?: string;
		deviceLabel?: string;
		preferences?: {
			oneOnOneEvents?: boolean;
			consultationEvents?: boolean;
			classReminder?: boolean;
		};
	};

	const endpoint = body?.subscription?.endpoint;
	const p256dh = body?.subscription?.keys?.p256dh;
	const auth = body?.subscription?.keys?.auth;
	if (!endpoint || !p256dh || !auth) {
		res.status(400).json({
			error: "subscription.endpoint, subscription.keys.p256dh and subscription.keys.auth are required",
			code: "VALIDATION_ERROR",
		});
		return;
	}

	try {
		await registerPushSubscription(user.id, {
			subscription: { endpoint, keys: { p256dh, auth } },
			ua: body.deviceLabel,
			role: body.role,
			preferences: body.preferences,
		});
		res.status(200).json({
			device: {
				id: endpoint,
				endpoint,
				deviceLabel: body.deviceLabel,
				role: body.role,
				preferences: body.preferences,
			},
		});
	} catch (err) {
		next(err);
	}
};

export const removeWebPushSubscription: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}
	const endpoint =
		typeof req.params.endpoint === "string"
			? decodeURIComponent(req.params.endpoint)
			: undefined;
	if (!endpoint) {
		res.status(400).json({ error: "endpoint required", code: "VALIDATION_ERROR" });
		return;
	}
	try {
		await unregisterPushSubscription(user.id, endpoint);
		res.status(200).json({ message: "Subscription removed" });
	} catch (err) {
		next(err);
	}
};

export const updateWebPushPreferences: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}
	const body = req.body as {
		oneOnOneEvents?: boolean;
		consultationEvents?: boolean;
		classReminder?: boolean;
	};
	try {
		const preferences = await updatePushPreferences(user.id, body || {});
		res.status(200).json({ preferences });
	} catch (err) {
		next(err);
	}
};

export const sendWebPushTest: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}
	try {
		await sendWebPushToUser(user.id, {
			title: "Fitflix push is on",
			body: "You'll see alerts here when something changes on your day.",
			url: "/admin/me/notifications",
			tag: "fitflix-test",
		});
		res.status(200).json({ message: "Test push sent" });
	} catch (err) {
		next(err);
	}
};

/**
 * Broadcast a push notification to every device subscribed to an FCM topic.
 * Admin-only (see notification.routes.ts). This is the scale-safe campaign
 * path: one FCM call reaches every subscriber regardless of audience size,
 * with no per-user DB read and no in-app Notification rows written — see
 * fcm.service.ts for the fan-out rationale and sendPushToTopic's limits.
 */
export const broadcastToTopic: RequestHandler = async (req, res, next) => {
	const { topic, title, body, data } = req.body as {
		topic?: string;
		title?: string;
		body?: string;
		data?: Record<string, unknown>;
	};

	if (!topic || typeof topic !== "string" || !isAllowedTopic(topic)) {
		res.status(400).json({
			error: "topic must be one of the allowed broadcast topics",
			code: "VALIDATION_ERROR",
		});
		return;
	}
	if (!title || !body) {
		res.status(400).json({
			error: "title and body are required",
			code: "VALIDATION_ERROR",
		});
		return;
	}

	try {
		const stringData = data
			? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
			: undefined;
		await sendPushToTopic(topic, { title, body, data: stringData });
		res.status(200).json({ message: "Broadcast sent", topic });
	} catch (err) {
		next(err);
	}
};

// -----------------------------------------------------------------------------
// Im-6 · Mobile member notification preferences & diagnostics
// -----------------------------------------------------------------------------

export const getMemberPreferences: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		let preferences = await NotificationPreferences.findOne({ userId: user.id });
		if (!preferences) {
			preferences = await NotificationPreferences.create({ userId: user.id });
		}
		res.status(200).json({ preferences });
	} catch (err) {
		next(err);
	}
};

export const updateMemberPreferences: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const parsed = updateNotificationPreferencesSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		let preferences = await NotificationPreferences.findOne({ userId: user.id });
		if (!preferences) {
			preferences = new NotificationPreferences({ userId: user.id });
		}

		const data = parsed.data;
		if (data.masterPushEnabled !== undefined) {
			preferences.masterPushEnabled = data.masterPushEnabled;
		}
		if (data.coachMessages) {
			if (data.coachMessages.directMessages) {
				preferences.coachMessages.directMessages = data.coachMessages.directMessages;
			}
			if (data.coachMessages.feedbackAndComments) {
				preferences.coachMessages.feedbackAndComments =
					data.coachMessages.feedbackAndComments;
			}
		}
		if (data.appointments) {
			if (data.appointments.sessionUpdates) {
				preferences.appointments.sessionUpdates = data.appointments.sessionUpdates;
			}
			if (data.appointments.reminderLeadMinutes !== undefined) {
				preferences.appointments.reminderLeadMinutes =
					data.appointments.reminderLeadMinutes;
			}
			if (data.appointments.waitlistAlerts) {
				preferences.appointments.waitlistAlerts = data.appointments.waitlistAlerts;
			}
		}
		if (data.workouts) {
			if (data.workouts.completionMode) {
				preferences.workouts.completionMode = data.workouts.completionMode;
			}
			if (data.workouts.completionFrequency) {
				preferences.workouts.completionFrequency =
					data.workouts.completionFrequency;
			}
			if (data.workouts.milestonesAndPrs) {
				preferences.workouts.milestonesAndPrs = data.workouts.milestonesAndPrs;
			}
			if (data.workouts.bcaScanSynced) {
				preferences.workouts.bcaScanSynced = data.workouts.bcaScanSynced;
			}
		}
		if (data.habits) {
			if (data.habits.weighInReminderEnabled !== undefined) {
				preferences.habits.weighInReminderEnabled =
					data.habits.weighInReminderEnabled;
			}
			if (data.habits.weighInTime) {
				preferences.habits.weighInTime = data.habits.weighInTime;
			}
			if (data.habits.waterNudgesEnabled !== undefined) {
				preferences.habits.waterNudgesEnabled = data.habits.waterNudgesEnabled;
			}
		}
		if (data.community) {
			if (data.community.repliesAndMentions) {
				preferences.community.repliesAndMentions =
					data.community.repliesAndMentions;
			}
			if (data.community.cheersAndLikes) {
				preferences.community.cheersAndLikes = data.community.cheersAndLikes;
			}
		}
		if (data.quietHours) {
			if (data.quietHours.enabled !== undefined) {
				preferences.quietHours.enabled = data.quietHours.enabled;
			}
			if (data.quietHours.startTime) {
				preferences.quietHours.startTime = data.quietHours.startTime;
			}
			if (data.quietHours.endTime) {
				preferences.quietHours.endTime = data.quietHours.endTime;
			}
		}

		await preferences.save();
		res.status(200).json({ preferences });
	} catch (err) {
		next(err);
	}
};

export const sendTestNotificationPush: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user) {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		await notify({
			userId: user.id,
			kind: NotificationKind.SystemTest,
			title: "Fitflix Notification Test",
			body: "The Fitflix notification engine is configured and working properly on your device.",
			channels: [NotificationChannel.InApp, NotificationChannel.Push],
			data: {
				test: true,
				sentAt: new Date().toISOString(),
			},
		});

		res.status(200).json({
			message: "Test notification dispatched successfully",
			sentAt: new Date(),
		});
	} catch (err) {
		next(err);
	}
};
