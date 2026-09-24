/**
 * FX-25 · Web Push (VAPID) fan-out for the staff PWA (frontdesk-fitflix).
 *
 * Mirrors the FCM pattern in `fcm.service.ts`: subscriptions live inline on the
 * `User` document under `pushSubscriptions[]` (select:false), and dead endpoints
 * (410 Gone / 404) are pruned automatically. `sendWebPushToUser` is called by
 * `notify()` when `NotificationChannel.Push` is requested, alongside the
 * existing FCM path.
 */
import webpush from "web-push";
import User from "../models/User";

let vapidReady = false;

export interface WebPushPayload {
	title: string;
	body: string;
	url?: string;
	tag?: string;
	data?: Record<string, unknown>;
}

export interface WebPushSubscriptionJson {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

function getVapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
	const publicKey = process.env.VAPID_PUBLIC_KEY;
	const privateKey = process.env.VAPID_PRIVATE_KEY;
	const subject = process.env.VAPID_SUBJECT || "mailto:ops@fitflix.local";
	if (!publicKey || !privateKey) {
		if (!vapidReady) {
			console.warn(
				"[webpush] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — Web Push disabled",
			);
			vapidReady = true; // Only warn once.
		}
		return null;
	}
	if (!vapidReady) {
		webpush.setVapidDetails(subject, publicKey, privateKey);
		vapidReady = true;
	}
	return { publicKey, privateKey, subject };
}

export function getVapidPublicKey(): string | null {
	return process.env.VAPID_PUBLIC_KEY || null;
}

export type PushEventPreferenceKey =
	| "oneOnOneEvents"
	| "consultationEvents"
	| "classReminder";

interface StoredSubscription {
	endpoint: string;
	p256dh: string;
	auth: string;
	ua?: string;
	role?: string;
	preferences?: {
		oneOnOneEvents?: boolean;
		consultationEvents?: boolean;
		classReminder?: boolean;
	};
	createdAt?: Date;
	lastSeenAt?: Date;
	lastNotifiedAt?: Date | null;
}

/**
 * Send a Web Push to every browser this user has enabled, optionally filtered
 * by which preference key gates this kind of event. Dead endpoints are pruned.
 */
export async function sendWebPushToUser(
	userId: string,
	payload: WebPushPayload,
	preferenceKey?: PushEventPreferenceKey,
): Promise<void> {
	const keys = getVapidKeys();
	if (!keys) return;

	const user = await User.findById(userId)
		.select("pushSubscriptions")
		.lean<{ pushSubscriptions?: StoredSubscription[] }>();

	const subs = user?.pushSubscriptions ?? [];
	if (subs.length === 0) return;

	const eligible = preferenceKey
		? subs.filter((s) => s.preferences?.[preferenceKey] !== false)
		: subs;
	if (eligible.length === 0) return;

	const body = JSON.stringify({
		title: payload.title,
		body: payload.body,
		url: payload.url,
		tag: payload.tag,
		data: payload.data,
	});

	const deadEndpoints: string[] = [];
	await Promise.all(
		eligible.map(async (sub) => {
			try {
				await webpush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth },
					},
					body,
					{ TTL: 60 * 10 },
				);
			} catch (err: unknown) {
				const statusCode = (err as { statusCode?: number })?.statusCode;
				// 404 / 410 → subscription is gone. Prune it.
				if (statusCode === 404 || statusCode === 410) {
					deadEndpoints.push(sub.endpoint);
				} else {
					console.error(
						"[webpush] Failed to deliver push",
						statusCode,
						(err as Error)?.message,
					);
				}
			}
		}),
	);

	if (deadEndpoints.length > 0) {
		await User.findByIdAndUpdate(userId, {
			$pull: { pushSubscriptions: { endpoint: { $in: deadEndpoints } } },
		}).catch(() => undefined);
	}

	// Best-effort mark delivered so the settings UI can show "last alert" time.
	if (eligible.length > deadEndpoints.length) {
		const liveEndpoints = eligible
			.map((s) => s.endpoint)
			.filter((ep) => !deadEndpoints.includes(ep));
		await User.updateOne(
			{ _id: userId, "pushSubscriptions.endpoint": { $in: liveEndpoints } },
			{ $set: { "pushSubscriptions.$[elem].lastNotifiedAt": new Date() } },
			{ arrayFilters: [{ "elem.endpoint": { $in: liveEndpoints } }] },
		).catch(() => undefined);
	}
}

export interface RegisterSubscriptionInput {
	subscription: WebPushSubscriptionJson;
	ua?: string;
	role?: string;
	preferences?: {
		oneOnOneEvents?: boolean;
		consultationEvents?: boolean;
		classReminder?: boolean;
	};
}

/**
 * Idempotent register: bumps lastSeenAt if the endpoint already exists,
 * otherwise pushes a new entry. Mirrors registerFcmToken's write pattern.
 */
export async function registerPushSubscription(
	userId: string,
	input: RegisterSubscriptionInput,
): Promise<void> {
	const { subscription, ua = "", role = "", preferences } = input;
	if (
		!subscription?.endpoint ||
		!subscription.keys?.p256dh ||
		!subscription.keys?.auth
	) {
		throw new Error("Invalid subscription payload");
	}
	const now = new Date();

	const setUpdates: Record<string, unknown> = {
		"pushSubscriptions.$.p256dh": subscription.keys.p256dh,
		"pushSubscriptions.$.auth": subscription.keys.auth,
		"pushSubscriptions.$.ua": ua,
		"pushSubscriptions.$.role": role,
		"pushSubscriptions.$.lastSeenAt": now,
	};
	if (preferences) {
		if (typeof preferences.oneOnOneEvents === "boolean") {
			setUpdates["pushSubscriptions.$.preferences.oneOnOneEvents"] =
				preferences.oneOnOneEvents;
		}
		if (typeof preferences.consultationEvents === "boolean") {
			setUpdates["pushSubscriptions.$.preferences.consultationEvents"] =
				preferences.consultationEvents;
		}
		if (typeof preferences.classReminder === "boolean") {
			setUpdates["pushSubscriptions.$.preferences.classReminder"] =
				preferences.classReminder;
		}
	}

	const updated = await User.updateOne(
		{ _id: userId, "pushSubscriptions.endpoint": subscription.endpoint },
		{ $set: setUpdates },
	);
	if (updated.matchedCount > 0) return;

	await User.updateOne(
		{ _id: userId },
		{
			$addToSet: {
				pushSubscriptions: {
					endpoint: subscription.endpoint,
					p256dh: subscription.keys.p256dh,
					auth: subscription.keys.auth,
					ua,
					role,
					preferences: {
						oneOnOneEvents: preferences?.oneOnOneEvents ?? true,
						consultationEvents: preferences?.consultationEvents ?? true,
						classReminder: preferences?.classReminder ?? true,
					},
					createdAt: now,
					lastSeenAt: now,
				},
			},
		},
	);
}

export async function unregisterPushSubscription(
	userId: string,
	endpoint: string,
): Promise<void> {
	await User.updateOne(
		{ _id: userId },
		{ $pull: { pushSubscriptions: { endpoint } } },
	);
}

export async function listPushSubscriptions(
	userId: string,
): Promise<StoredSubscription[]> {
	const user = await User.findById(userId)
		.select("pushSubscriptions")
		.lean<{ pushSubscriptions?: StoredSubscription[] }>();
	return user?.pushSubscriptions ?? [];
}

export async function updatePushPreferences(
	userId: string,
	preferences: {
		oneOnOneEvents?: boolean;
		consultationEvents?: boolean;
		classReminder?: boolean;
	},
): Promise<{
	oneOnOneEvents: boolean;
	consultationEvents: boolean;
	classReminder: boolean;
}> {
	const setUpdates: Record<string, unknown> = {};
	if (typeof preferences.oneOnOneEvents === "boolean") {
		setUpdates["pushSubscriptions.$[].preferences.oneOnOneEvents"] =
			preferences.oneOnOneEvents;
	}
	if (typeof preferences.consultationEvents === "boolean") {
		setUpdates["pushSubscriptions.$[].preferences.consultationEvents"] =
			preferences.consultationEvents;
	}
	if (typeof preferences.classReminder === "boolean") {
		setUpdates["pushSubscriptions.$[].preferences.classReminder"] =
			preferences.classReminder;
	}
	if (Object.keys(setUpdates).length > 0) {
		await User.updateOne({ _id: userId }, { $set: setUpdates });
	}
	const subs = await listPushSubscriptions(userId);
	const first = subs[0];
	return {
		oneOnOneEvents: first?.preferences?.oneOnOneEvents ?? true,
		consultationEvents: first?.preferences?.consultationEvents ?? true,
		classReminder: first?.preferences?.classReminder ?? true,
	};
}
