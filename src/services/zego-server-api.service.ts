import { createHash, randomBytes } from "node:crypto";

/**
 * Thin client for ZegoCloud's server-side Room REST API.
 *
 * There is no dependency for this — it's a handful of signed GET requests, so
 * `node:crypto` + global `fetch` cover it. Used only to force-disconnect
 * participants when a host ends a class; the DB (`ScheduledSession.status`)
 * is the actual source of truth, this is a best-effort convenience on top.
 *
 * Docs: https://www.zegocloud.com/docs/server-api/ — signature scheme is
 * `Signature = MD5(AppId + SignatureNonce + ServerSecret + Timestamp)`.
 * There is no "dissolve room" action: a room with zero users is torn down by
 * Zego's own infrastructure automatically, so kicking everyone out *is* the
 * dissolve.
 */

const RTC_API_BASE = process.env.ZEGO_RTC_API_BASE ?? "https://rtc-api.zego.im/";

// Max UserId[] entries accepted per KickoutUser call.
const KICK_BATCH_SIZE = 5;

type ZegoApiConfig = {
	appId: number;
	serverSecret: string;
};

/**
 * Reads the server-side Zego credentials from the environment, returning null
 * if either is missing/unparseable rather than throwing — callers that only
 * need a best-effort kickout (the lifecycle sweep, the manual end endpoint)
 * should degrade to "skip the kick" rather than fail the whole operation.
 */
export const readZegoServerConfig = (): ZegoApiConfig | null => {
	const appIdStr = process.env.ZEGO_APP_ID;
	const serverSecret = process.env.ZEGO_SERVER_SECRET;
	if (!appIdStr || !serverSecret) return null;

	const appId = Number.parseInt(appIdStr, 10);
	if (Number.isNaN(appId)) return null;

	return { appId, serverSecret };
};

type ZegoApiEnvelope<T> = {
	Code: number;
	Message: string;
	RequestId: string;
	Data?: T;
};

const buildSignedParams = (
	config: ZegoApiConfig,
	action: string,
	extra: Record<string, string>,
): URLSearchParams => {
	const signatureNonce = randomBytes(8).toString("hex");
	const timestamp = Math.floor(Date.now() / 1000).toString();

	const signature = createHash("md5")
		.update(`${config.appId}${signatureNonce}${config.serverSecret}${timestamp}`)
		.digest("hex");

	const params = new URLSearchParams({
		Action: action,
		AppId: String(config.appId),
		SignatureNonce: signatureNonce,
		Timestamp: timestamp,
		SignatureVersion: "2.0",
		Signature: signature,
		...extra,
	});

	return params;
};

const callZegoApi = async <T>(
	config: ZegoApiConfig,
	action: string,
	extra: Record<string, string>,
): Promise<ZegoApiEnvelope<T>> => {
	const params = buildSignedParams(config, action, extra);
	const response = await fetch(`${RTC_API_BASE}?${params.toString()}`, {
		method: "GET",
	});

	if (!response.ok) {
		throw new Error(
			`ZegoCloud REST API HTTP ${response.status} for action ${action}`,
		);
	}

	return (await response.json()) as ZegoApiEnvelope<T>;
};

const arrayParams = (key: string, values: string[]): Record<string, string> =>
	Object.fromEntries(values.map((value, i) => [`${key}.${i}`, value]));

/**
 * Lists user ids currently logged into a room, paginating on `Marker`.
 * ZegoCloud rate-limits this to 1 request/second per room — callers here are
 * on the "end a single class" path, never a loop over many rooms.
 */
export const listRoomUsers = async (
	config: ZegoApiConfig,
	roomId: string,
): Promise<string[]> => {
	const userIds: string[] = [];
	let marker = "";

	do {
		const envelope = await callZegoApi<{
			UserList?: Array<{ UserId: string }>;
			Marker?: string;
		}>(config, "DescribeUserList", {
			RoomId: roomId,
			...(marker ? { Marker: marker } : {}),
		});

		if (envelope.Code !== 0) {
			throw new Error(
				`ZegoCloud DescribeUserList failed (${envelope.Code}): ${envelope.Message}`,
			);
		}

		for (const entry of envelope.Data?.UserList ?? []) {
			userIds.push(entry.UserId);
		}
		marker = envelope.Data?.Marker ?? "";
	} while (marker);

	return userIds;
};

export type KickResult = {
	kicked: string[];
	errors: Array<{ userIds: string[]; message: string }>;
};

/**
 * Force-disconnects the given users from a room, chunking into batches of 5
 * (ZegoCloud's per-call limit) and staying under the 50/s per-AppID kick rate
 * by running batches sequentially rather than in parallel.
 */
export const kickoutUsers = async (
	config: ZegoApiConfig,
	roomId: string,
	userIds: string[],
	reason = "Class ended by host",
): Promise<KickResult> => {
	const kicked: string[] = [];
	const errors: KickResult["errors"] = [];

	for (let i = 0; i < userIds.length; i += KICK_BATCH_SIZE) {
		const batch = userIds.slice(i, i + KICK_BATCH_SIZE);
		try {
			const envelope = await callZegoApi(config, "KickoutUser", {
				RoomId: roomId,
				Reason: reason,
				...arrayParams("UserId", batch),
			});

			if (envelope.Code !== 0) {
				errors.push({ userIds: batch, message: envelope.Message });
				continue;
			}
			kicked.push(...batch);
		} catch (error) {
			errors.push({
				userIds: batch,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return { kicked, errors };
};

/**
 * Lists then kicks everyone currently in `roomId`. Best-effort: a Zego outage
 * or misconfigured credentials here must never block ending a class — the DB
 * status flip is what actually closes the class to new joins.
 */
export const forceDisconnectRoom = async (
	config: ZegoApiConfig,
	roomId: string,
	reason?: string,
): Promise<KickResult> => {
	const userIds = await listRoomUsers(config, roomId);
	if (userIds.length === 0) {
		return { kicked: [], errors: [] };
	}
	return kickoutUsers(config, roomId, userIds, reason);
};
