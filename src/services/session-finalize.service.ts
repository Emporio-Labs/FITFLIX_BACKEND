import mongoose from "mongoose";
import Booking from "../models/Bookings";
import ScheduledSession from "../models/ScheduledSession";
import { nonCancelledBookingStatusFilter, resolveSessionRoomId } from "../utils/zego-room";
import { forceDisconnectRoom } from "./zego-server-api.service";

export type FinalizeResult = {
	attendanceMarked: number;
	kicked: string[];
	kickErrors: Array<{ userIds: string[]; message: string }>;
};

export type FinalizeZegoConfig = { appId: number; serverSecret: string };

/**
 * Shared teardown for a session's room, whatever triggered it — an explicit
 * host "End" click (zego.controller.ts) or the T+30 expiry sweep
 * (session-room-lifecycle.service.ts). Both paths must flip status, backfill
 * attendance, and best-effort kick in exactly the same order, or a kicked
 * client's instant token retry could race an open door in one path and a
 * closed one in the other. Extracted so there is exactly one implementation.
 */
export async function finalizeSession(
	session: InstanceType<typeof ScheduledSession>,
	opts: {
		/// User id of the host who ended it, or null for a system (expiry) end.
		endedBy: string | null;
		endedAt?: Date;
		reason: string;
		zegoConfig: FinalizeZegoConfig | null;
	},
): Promise<FinalizeResult> {
	const sessionId = String(session._id);

	// Idempotent: a session already COMPLETED (e.g. the host ended it a moment
	// before the sweep claimed it) is left as-is rather than overwriting who
	// ended it or when.
	if (session.status !== "COMPLETED") {
		session.status = "COMPLETED";
		session.endedAt = opts.endedAt ?? new Date();
		session.endedBy =
			opts.endedBy && mongoose.Types.ObjectId.isValid(opts.endedBy)
				? new mongoose.Types.ObjectId(opts.endedBy)
				: null;
		await session.save();
	}

	const attendanceResult = await Booking.updateMany(
		{
			sessionId,
			joinedAt: { $ne: null },
			status: nonCancelledBookingStatusFilter,
		},
		{ $set: { status: "Attended", leftAt: new Date() } },
	);

	let kicked: string[] = [];
	let kickErrors: FinalizeResult["kickErrors"] = [];

	if (opts.zegoConfig) {
		const roomId = resolveSessionRoomId(session);
		if (roomId) {
			try {
				const result = await forceDisconnectRoom(
					{ appId: opts.zegoConfig.appId, serverSecret: opts.zegoConfig.serverSecret },
					roomId,
					opts.reason,
				);
				kicked = result.kicked;
				kickErrors = result.errors;
			} catch (error) {
				// Best-effort — Zego being unreachable must never block finalizing a
				// session. The COMPLETED flip above is what actually closes it.
				kickErrors = [
					{
						userIds: [],
						message: error instanceof Error ? error.message : String(error),
					},
				];
			}
		}
	}

	return { attendanceMarked: attendanceResult.modifiedCount, kicked, kickErrors };
}
