import admin from "firebase-admin";
import mongoose from "mongoose";
import User from "../models/User";

let initialized = false;

function getApp(): admin.app.App | null {
	if (initialized) return admin.app();

	const encoded = process.env.FCM_SERVICE_ACCOUNT_JSON;
	if (!encoded) {
		console.warn(
			"[fcm] FCM_SERVICE_ACCOUNT_JSON not set — push notifications disabled",
		);
		return null;
	}

	try {
		const serviceAccount = JSON.parse(
			Buffer.from(encoded, "base64").toString("utf-8"),
		) as admin.ServiceAccount;

		admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
		initialized = true;
		console.log("[fcm] Firebase Admin initialized");
		return admin.app();
	} catch (err) {
		console.error("[fcm] Failed to initialize Firebase Admin", err);
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
 * Register or refresh an FCM token for a user.
 * Called by the mobile app when it receives a new FCM token.
 */
export async function registerFcmToken(
	userId: string,
	token: string,
	platform: "ios" | "android",
): Promise<void> {
	await User.findByIdAndUpdate(userId, {
		$pull: { fcmTokens: { token } }, // remove if exists (avoid dups)
	});

	await User.findByIdAndUpdate(userId, {
		$push: {
			fcmTokens: { token, platform, lastSeenAt: new Date() },
		},
	});
}
