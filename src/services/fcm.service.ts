import admin from "firebase-admin";
import mongoose from "mongoose";
import User from "../models/User";

let initialized = false;

export function getApp(): admin.app.App | null {
	if (initialized) return admin.app();

	const encoded = process.env.FCM_SERVICE_ACCOUNT_JSON;
	console.log("[fcm] process.env.FCM_SERVICE_ACCOUNT_JSON exists:", !!encoded);
	if (!encoded) {
		console.warn(
			"[fcm] FCM_SERVICE_ACCOUNT_JSON not set — push notifications disabled",
		);
		return null;
	}

	try {
		console.log("[fcm] Attempting Firebase Admin SDK initialization...");
		const serviceAccount = JSON.parse(
			Buffer.from(encoded, "base64").toString("utf-8"),
		) as admin.ServiceAccount;

		admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
		initialized = true;
		console.log("[fcm] Firebase Admin initialized successfully");
		return admin.app();
	} catch (err) {
		console.error("[fcm] Failed to initialize Firebase Admin, error:", err);
		return null;
	}
}

export interface FcmMessage {
	title: string;
	body: string;
	data?: Record<string, string>;
}

/**
 * Send a push notification to all FCM tokens registered for a user.
 * Dead tokens are pruned automatically.
 */
export async function sendPushToUser(
	userId: string,
	message: FcmMessage,
): Promise<void> {
	const app = getApp();
	if (!app) return;

	const user = await User.findById(userId)
		.select("fcmTokens")
		.lean<{ fcmTokens?: Array<{ token: string; platform: string }> }>();

	const tokens = user?.fcmTokens?.map((t) => t.token) ?? [];
	if (tokens.length === 0) return;

	const messaging = admin.messaging(app);

	const response = await messaging.sendEachForMulticast({
		tokens,
		notification: { title: message.title, body: message.body },
		data: message.data,
		android: { priority: "high" },
		apns: {
			payload: {
				aps: {
					alert: { title: message.title, body: message.body },
					sound: "default",
				},
			},
		},
	});

	// Prune dead tokens
	const deadTokens: string[] = [];
	response.responses.forEach((r: any, idx: number) => {
		if (
			!r.success &&
			(r.error?.code === "messaging/registration-token-not-registered" ||
				r.error?.code === "messaging/invalid-registration-token")
		) {
			const token = tokens[idx];
			if (token) deadTokens.push(token);
		}
	});

	if (deadTokens.length > 0) {
		await User.findByIdAndUpdate(userId, {
			$pull: { fcmTokens: { token: { $in: deadTokens } } },
		}).catch(() => {});
	}
}

/**
 * Send one push to every device subscribed to an FCM topic.
 *
 * This is the broadcast path: devices call
 * `FirebaseMessaging.subscribeToTopic()` directly against Google, which
 * costs this server nothing, so a campaign reaching millions of devices is
 * still exactly one call here — no per-user DB read, no per-user send.
 * Trade-off: a topic message can't be personalised (no per-user data), and
 * Google's guidance caps sustained throughput at roughly one message/second
 * per topic, so this is for campaigns, not transactional notifications —
 * {@link sendPushToUser} remains the path for those.
 *
 * Callers MUST validate `topic` against {@link isAllowedTopic} first; this
 * function does not — it is not itself a trust boundary.
 */
export async function sendPushToTopic(
	topic: string,
	message: FcmMessage,
): Promise<void> {
	const app = getApp();
	if (!app) return;

	await admin.messaging(app).send({
		topic,
		notification: { title: message.title, body: message.body },
		data: message.data,
		android: { priority: "high" },
		apns: {
			payload: {
				aps: {
					alert: { title: message.title, body: message.body },
					sound: "default",
				},
			},
		},
	});
}

/**
 * Static topics the client is allowed to subscribe to, plus the
 * `gym_<locationId>` pattern (validated as a real ObjectId, not just the
 * prefix — a broadcast topic is not a place to trust arbitrary client
 * input). Keep in sync with the client's subscription list.
 */
const STATIC_TOPICS = new Set(["all_users", "plat_android", "plat_ios"]);
const GYM_TOPIC_RE = /^gym_([a-f0-9]{24})$/;

export function isAllowedTopic(topic: string): boolean {
	if (STATIC_TOPICS.has(topic)) return true;
	const match = GYM_TOPIC_RE.exec(topic);
	return match !== null && mongoose.Types.ObjectId.isValid(match[1]!);
}

/**
 * Register or refresh an FCM token for a user.
 * Called by the mobile app when it receives a new FCM token — in steady
 * state this is a heartbeat on an already-registered token, so the common
 * path is a single write: try to bump `lastSeenAt` on the existing array
 * entry, and only fall back to a second write (`$addToSet`) the first time a
 * given token is seen. Two sequential $pull/$push writes on every call, as
 * this used to do, doubles write load for no benefit once a token is stable.
 */
export async function registerFcmToken(
	userId: string,
	token: string,
	platform: "ios" | "android",
): Promise<void> {
	const updated = await User.updateOne(
		{ _id: userId, "fcmTokens.token": token },
		{
			$set: {
				"fcmTokens.$.platform": platform,
				"fcmTokens.$.lastSeenAt": new Date(),
			},
		},
	);

	if (updated.matchedCount > 0) return;

	await User.updateOne(
		{ _id: userId },
		{ $addToSet: { fcmTokens: { token, platform, lastSeenAt: new Date() } } },
	);
}
