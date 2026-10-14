import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Recording from "../models/Recording";
import { checkReplayAccess } from "../services/replay-access.service";
import {
	generateSignedPlaybackToken,
	verifyPlaybackToken,
} from "../services/zego-recording.service";
import type { AuthenticatedUser } from "../types/auth";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
		return null;
	}
	return idParam;
};

/**
 * GET /api/v1/recordings/replays
 * FX-23.2 & FX-23.4: Member replay list.
 * Only returns active, non-hidden, non-deleted recordings ready for playback.
 */
export const listMemberReplays: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user as AuthenticatedUser | undefined;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const replays = await Recording.find({
			status: "READY",
			isHidden: false,
			isDeleted: false,
			sessionType: "live_stream",
		})
			.sort({ startedAt: -1 })
			.limit(100)
			.lean();

		const mapped = replays.map((r) => ({
			id: String(r._id),
			title: r.title,
			sessionType: r.sessionType || "live_stream",
			instructorName: r.instructorName,
			durationSeconds: r.durationSeconds,
			durationMinutes: Math.ceil((r.durationSeconds || 0) / 60),
			sessionDate: r.startedAt,
			thumbnailUrl: r.thumbnailUrl,
			sessionId: r.sessionId,
			classId: r.classId,
			viewsCount: r.viewsCount,
		}));

		res.status(200).json({
			success: true,
			count: mapped.length,
			replays: mapped,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * GET /api/v1/recordings/:id/playback
 * FX-23.3 & FX-23.5: Generates short-lived, signed playback URL for entitled members.
 */
export const getReplayPlayback: RequestHandler = async (req, res, next) => {
	try {
		const user = req.user as AuthenticatedUser | undefined;
		if (!user) {
			res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
			return;
		}

		const id = getIdParam(req.params.id);
		if (!id) {
			res.status(400).json({ error: "Invalid recording ID", code: "BAD_REQUEST" });
			return;
		}

		const recording = await Recording.findById(id);
		if (!recording || recording.isDeleted) {
			res.status(404).json({ error: "Recording not found", code: "NOT_FOUND" });
			return;
		}

		if (recording.isHidden && user.role !== "admin") {
			res.status(404).json({ error: "Recording not available", code: "NOT_FOUND" });
			return;
		}

		if (recording.status !== "READY") {
			res.status(409).json({
				error: "Recording is still processing. Please try again shortly.",
				code: "RECORDING_NOT_READY",
			});
			return;
		}

		// FX-23.3: Verify that this member is entitled to watch this livestream replay
		const accessCheck = await checkReplayAccess(user.id, user.role, recording);
		if (!accessCheck.allowed) {
			res.status(403).json({
				error: accessCheck.message,
				code: accessCheck.code,
			});
			return;
		}

		// Increment view count
		await Recording.findByIdAndUpdate(id, { $inc: { viewsCount: 1 } });

		// FX-23.5: Generate signed, time-limited token (15 minutes / 900 seconds)
		const { token, expiresAt } = generateSignedPlaybackToken(
			id,
			user.id,
			900,
		);

		const streamUrl = `/api/v1/recordings/${id}/stream?token=${encodeURIComponent(token)}`;

		res.status(200).json({
			success: true,
			recording: {
				id: String(recording._id),
				title: recording.title,
				instructorName: recording.instructorName,
				durationSeconds: recording.durationSeconds,
				thumbnailUrl: recording.thumbnailUrl,
				fileUrl: recording.fileUrl,
				streamUrl,
				token,
				expiresAt,
				expiresInSeconds: 900,
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * GET /api/v1/recordings/:id/stream
 * FX-23.5: Gateway for playback stream URL.
 * Replay link copied out of the app stops working after a short time (15 mins).
 */
export const streamReplay: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		const token = req.query.token as string | undefined;

		if (!id) {
			res.status(400).json({ error: "Invalid recording ID", code: "BAD_REQUEST" });
			return;
		}

		if (!token) {
			res.status(403).json({
				error: "Access token required to play stream",
				code: "TOKEN_REQUIRED",
			});
			return;
		}

		const verification = verifyPlaybackToken(id, token);
		if (!verification.valid) {
			res.status(410).json({
				error:
					"This replay link has expired. For your security, livestream playback links expire after 15 minutes. Please open the replay again inside the app.",
				code: "LINK_EXPIRED",
				reason: verification.reason,
			});
			return;
		}

		const recording = await Recording.findById(id).select("fileUrl isHidden isDeleted status");
		if (!recording || recording.isDeleted || recording.isHidden) {
			res.status(404).json({ error: "Recording unavailable", code: "NOT_FOUND" });
			return;
		}

		// Redirect to signed asset or cloud storage URL
		if (recording.fileUrl) {
			res.redirect(302, recording.fileUrl);
			return;
		}

		res.status(200).json({ message: "Stream validated", status: recording.status });
	} catch (error) {
		next(error);
	}
};

/**
 * GET /api/v1/admin/recordings
 * FX-23.4: Admin listing of all recordings with visibility status.
 */
export const listAdminRecordings: RequestHandler = async (_req, res, next) => {
	try {
		const recordings = await Recording.find({ isDeleted: false })
			.sort({ createdAt: -1 })
			.lean();

		res.status(200).json({
			success: true,
			recordings,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * PATCH /api/v1/admin/recordings/:id/visibility
 * FX-23.4: Hide or show recording. A hidden recording disappears from the app.
 */
export const updateRecordingVisibility: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);
		const { isHidden } = req.body;

		if (!id) {
			res.status(400).json({ error: "Invalid recording ID", code: "BAD_REQUEST" });
			return;
		}

		if (typeof isHidden !== "boolean") {
			res.status(400).json({
				error: "isHidden boolean field is required",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const recording = await Recording.findByIdAndUpdate(
			id,
			{ $set: { isHidden } },
			{ new: true },
		);

		if (!recording) {
			res.status(404).json({ error: "Recording not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({
			success: true,
			message: isHidden
				? "Recording hidden from member app"
				: "Recording visible in member app",
			recording,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * DELETE /api/v1/admin/recordings/:id
 * FX-23.4: Delete recording (soft-delete). Disappears from the app.
 */
export const deleteRecording: RequestHandler = async (req, res, next) => {
	try {
		const id = getIdParam(req.params.id);

		if (!id) {
			res.status(400).json({ error: "Invalid recording ID", code: "BAD_REQUEST" });
			return;
		}

		const recording = await Recording.findByIdAndUpdate(
			id,
			{ $set: { isDeleted: true, isHidden: true } },
			{ new: true },
		);

		if (!recording) {
			res.status(404).json({ error: "Recording not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({
			success: true,
			message: "Recording deleted successfully",
		});
	} catch (error) {
		next(error);
	}
};
