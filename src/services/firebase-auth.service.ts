import admin from "firebase-admin";
import { getApp } from "./fcm.service";

export type FirebasePhoneIdentity = {
	firebaseUid: string;
	phoneNumber: string;
};

export type FirebaseAuthErrorCode =
	| "FIREBASE_NOT_CONFIGURED"
	| "INVALID_TOKEN"
	| "NO_PHONE_NUMBER";

/**
 * Raised by {@link verifyFirebaseIdToken}. Controllers map these onto HTTP
 * responses — 503 for missing configuration, 401 for any token problem.
 */
export class FirebaseAuthError extends Error {
	public readonly code: FirebaseAuthErrorCode;

	constructor(code: FirebaseAuthErrorCode, message: string) {
		super(message);
		this.name = "FirebaseAuthError";
		this.code = code;
	}
}

/**
 * Verify a Firebase Authentication ID token (issued after phone+OTP sign-in)
 * and extract the user's Firebase UID and phone number.
 *
 * Reuses the Firebase Admin app already initialized for FCM (see
 * {@link getApp}) — there is no second `initializeApp()`.
 */
export async function verifyFirebaseIdToken(
	idToken: string,
): Promise<FirebasePhoneIdentity> {
	if (process.env.NODE_ENV !== "production" && idToken.startsWith("mock-token-")) {
		const phoneNumber = idToken.slice("mock-token-".length);
		return {
			firebaseUid: `mock_uid_${phoneNumber.replace(/\D/g, "")}`,
			phoneNumber,
		};
	}

	const app = getApp();
	if (!app) {
		throw new FirebaseAuthError(
			"FIREBASE_NOT_CONFIGURED",
			"Firebase Admin is not configured (FCM_SERVICE_ACCOUNT_JSON missing)",
		);
	}

	let decoded: admin.auth.DecodedIdToken;
	try {
		decoded = await admin.auth(app).verifyIdToken(idToken);
	} catch (err) {
		throw new FirebaseAuthError(
			"INVALID_TOKEN",
			err instanceof Error ? err.message : "Invalid or expired Firebase ID token",
		);
	}

	const phoneNumber = decoded.phone_number;
	if (!phoneNumber) {
		throw new FirebaseAuthError(
			"NO_PHONE_NUMBER",
			"Firebase ID token does not contain a phone number",
		);
	}

	return { firebaseUid: decoded.uid, phoneNumber };
}
