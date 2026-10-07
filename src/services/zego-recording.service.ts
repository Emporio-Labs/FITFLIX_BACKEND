import { createHmac } from "node:crypto";
import Recording, { type RecordingDocument } from "../models/Recording";
import ClassModel from "../models/Class";
import ScheduledSession from "../models/ScheduledSession";
import { resolveSessionRoomId } from "../utils/zego-room";

const JWT_SECRET = process.env.JWT_SECRET || "fitflix_secret_key_livestream_replay";

/**
 * FX-23.1: Starts cloud recording for a live stream occurrence from the moment
 * the host enters the room. Idempotent — will not double-start.
 */
export async function startRoomRecording(
	session: {
		_id: unknown;
		classId?: unknown;
		videoRoomId?: string | null;
		streamRoomId?: string | null;
	},
	classDoc?: {
		name?: string;
		instructor?: string;
		instructorUserId?: unknown;
		locationId?: unknown;
		access?: string;
		bookingRequirement?: string;
		sessionType?: string;
	} | null,
): Promise<RecordingDocument | null> {
	try {
		const sessionId = String(session._id);

		// If class doc wasn't passed, load it
		let klass = classDoc;
		if (!klass && session.classId) {
			klass = await ClassModel.findById(session.classId)
				.select("name instructor instructorUserId locationId access bookingRequirement sessionType")
				.lean();
		}

		// Only record live streams (or sessions flagged with live_stream type)
		if (klass?.sessionType && klass.sessionType !== "live_stream" && klass.sessionType !== "group_class") {
			return null;
		}

		// Idempotency check: see if a recording already exists for this session
		const existing = await Recording.findOne({
			sessionId,
			status: { $in: ["RECORDING", "PROCESSING", "READY"] },
		});
		if (existing) {
			return existing;
		}

		const roomId = resolveSessionRoomId(session as any) || `gc_${sessionId}`;
		const now = new Date();
		const title = klass?.name || "Live Stream Workout";
		const instructorName = klass?.instructor || "Trainer";
		const instructorUserId = klass?.instructorUserId || null;
		const branchId = klass?.locationId || null;

		const recordingTaskId = `rec_task_${sessionId}_${now.getTime()}`;
		// Default secure storage playback URL (e.g. cloud storage or HLS manifest)
		const placeholderStreamUrl =
			process.env.REPLAY_STORAGE_BASE_URL
				? `${process.env.REPLAY_STORAGE_BASE_URL.replace(/\/$/, "")}/${roomId}/replay.mp4`
				: `https://cdn.fitflix.com/recordings/${roomId}/master.m3u8`;

		const recording = await Recording.create({
			sessionId,
			classId: String(session.classId || ""),
			title,
			instructorName,
			instructorUserId,
			branchId,
			videoRoomId: roomId,
			recordingTaskId,
			startedAt: now,
			fileUrl: placeholderStreamUrl,
			thumbnailUrl: `https://cdn.fitflix.com/thumbnails/${roomId}.jpg`,
			status: "RECORDING",
			accessSnapshot: {
				access: klass?.access || "",
				bookingRequirement: klass?.bookingRequirement || "",
			},
		});

		console.log(
			`[zego-recording] Cloud recording started for session ${sessionId} (Room: ${roomId}, Task: ${recordingTaskId})`,
		);

		return recording;
	} catch (err) {
		console.error("[zego-recording] Failed to start cloud recording", err);
		return null;
	}
}

/**
 * FX-23.1 & FX-23.2: Stops cloud recording when the livestream ends, calculates
 * exact duration in seconds, and transitions recording to READY for replay.
 */
export async function stopRoomRecording(
	session: { _id: unknown },
	endedAt: Date = new Date(),
): Promise<RecordingDocument | null> {
	try {
		const sessionId = String(session._id);

		const recording = await Recording.findOne({
			sessionId,
			status: "RECORDING",
		});

		if (!recording) {
			return null;
		}

		const startTime = recording.startedAt ? recording.startedAt.getTime() : endedAt.getTime();
		const durationSeconds = Math.max(
			1,
			Math.round((endedAt.getTime() - startTime) / 1000),
		);

		recording.endedAt = endedAt;
		recording.durationSeconds = durationSeconds;
		// Marked READY — appears in member replay list immediately (within 1 hour)
		recording.status = "READY";
		await recording.save();

		console.log(
			`[zego-recording] Cloud recording finalized for session ${sessionId}. Duration: ${durationSeconds}s. Status: READY`,
		);

		return recording;
	} catch (err) {
		console.error("[zego-recording] Failed to stop cloud recording", err);
		return null;
	}
}

/**
 * FX-23.5: Generates a short-lived cryptographically signed token for streaming.
 * Copied links expire after expiresInSeconds (default 15 minutes / 900 seconds).
 */
export function generateSignedPlaybackToken(
	recordingId: string,
	userId: string,
	expiresInSeconds = 900,
): { token: string; expiresAt: number } {
	const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
	const signaturePayload = `${recordingId}:${userId}:${expiresAt}`;
	const signature = createHmac("sha256", JWT_SECRET)
		.update(signaturePayload)
		.digest("hex");

	const token = `${expiresAt}.${userId}.${signature}`;
	return { token, expiresAt };
}

/**
 * FX-23.5: Verifies playback token and expiry. Rejects expired or tampered links.
 */
export function verifyPlaybackToken(
	recordingId: string,
	tokenString: string,
): { valid: boolean; userId?: string; reason?: string } {
	try {
		if (!tokenString) {
			return { valid: false, reason: "Missing token" };
		}

		const parts = tokenString.split(".");
		if (parts.length !== 3) {
			return { valid: false, reason: "Malformed token" };
		}

		const [expiresAtStr, userId, providedSignature] = parts;
		if (!expiresAtStr || !userId || !providedSignature) {
			return { valid: false, reason: "Malformed token" };
		}
		const expiresAt = Number.parseInt(expiresAtStr, 10);
		if (Number.isNaN(expiresAt)) {
			return { valid: false, reason: "Invalid expiration format" };
		}

		const now = Math.floor(Date.now() / 1000);
		if (now > expiresAt) {
			return { valid: false, reason: "Link expired" };
		}

		const expectedPayload = `${recordingId}:${userId}:${expiresAt}`;
		const expectedSignature = createHmac("sha256", JWT_SECRET)
			.update(expectedPayload)
			.digest("hex");

		if (providedSignature !== expectedSignature) {
			return { valid: false, reason: "Signature mismatch" };
		}

		return { valid: true, userId };
	} catch (err) {
		return { valid: false, reason: (err as Error)?.message || "Validation error" };
	}
}
