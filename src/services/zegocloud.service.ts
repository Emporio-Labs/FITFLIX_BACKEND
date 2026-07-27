export interface ZegocloudConfig {
	appID: number;
	appSign: string;
}

export interface ZegocloudRoomCredentials {
	appID: number;
	appSign: string;
	conferenceID: string;
	userID: string;
	userName: string;
}

/**
 * Sanitizes IDs to contain only numbers, letters, and underlines (_) as required by ZEGOCLOUD SDKs.
 */
export function sanitizeZegoIdentifier(id: string): string {
	if (!id) return "default_id";
	return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function getZegocloudConfig(): ZegocloudConfig {
	const rawAppId = process.env.ZEGOCLOUD_APP_ID || process.env.ZEGO_APP_ID || "1234567890";
	const appID = Number.parseInt(rawAppId, 10) || 1234567890;
	const appSign =
		process.env.ZEGOCLOUD_APP_SIGN ||
		process.env.ZEGO_APP_SIGN ||
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

	return { appID, appSign };
}

export function generateRoomCredentials(params: {
	conferenceID: string;
	userID: string;
	userName?: string;
}): ZegocloudRoomCredentials {
	const config = getZegocloudConfig();
	const sanitizedConferenceID = sanitizeZegoIdentifier(params.conferenceID);
	const sanitizedUserID = sanitizeZegoIdentifier(params.userID);
	const userName = params.userName?.trim() || `User_${sanitizedUserID.slice(0, 8)}`;

	return {
		appID: config.appID,
		appSign: config.appSign,
		conferenceID: sanitizedConferenceID,
		userID: sanitizedUserID,
		userName,
	};
}
