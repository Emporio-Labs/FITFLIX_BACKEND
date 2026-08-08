import { config } from "dotenv";
import mongoose from "mongoose";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import connectDB from "../src/utils/db";
import {
	buildRoomTimeline,
	combineSessionDateTime,
	deriveRoomId,
	ROOM_LEAD_MINUTES,
} from "../src/utils/zego-room";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run backfill:session-room-ids [--dry-run]");
	console.log("  --dry-run   Report what would change without writing");
};

// These are Zego *layout templates* (Class.streamRoomId / the frontdesk
// "Session Layout Template" select), not room ids. Before resolveSessionRoomId
// existed, the token endpoint fell back to streamRoomId ahead of session._id,
// so any ScheduledSession whose videoRoomId happens to equal one of these
// strings is actually sharing a Zego room with every other online class that
// was ever assigned the same template. See utils/zego-room.ts.
const LAYOUT_TEMPLATE_STRINGS = new Set([
	"interactive_class",
	"large_event",
	"standard_meeting",
]);

const BATCH_SIZE = 500;

/**
 * Normalizes every ScheduledSession's `videoRoomId` to the deterministic
 * `deriveRoomId(_id)` form, fixing two kinds of drift:
 *
 *  1. `videoRoomId` is null/empty — the common case, since it was previously
 *     only ever written by the manual admin create-occurrence path.
 *  2. `videoRoomId` equals a layout-template string — sessions that were
 *     resolving to a room shared platform-wide (see LAYOUT_TEMPLATE_STRINGS).
 *
 * Also recomputes roomStatus/roomReadyAt/roomExpiresAt from the timeline vs.
 * "now", so a session already past its lead time comes out of this backfill
 * READY (or EXPIRED) rather than sitting PENDING until the next tick happens
 * to notice it — and, symmetrically, a still-untouched future session comes
 * out PENDING with no roomReadyAt/roomExpiresAt guessed early.
 *
 * Safe to re-run: sessions whose videoRoomId is already a distinct, non-
 * template value are left untouched.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");
	const now = new Date();

	try {
		await connectDB();

		const needsFix = {
			$or: [
				{ videoRoomId: null },
				{ videoRoomId: "" },
				{ videoRoomId: { $in: [...LAYOUT_TEMPLATE_STRINGS] } },
			],
		};

		const totalToFix = await ScheduledSession.countDocuments(needsFix);
		console.log(
			`${dryRun ? "[dry-run] " : ""}Found ${totalToFix} session(s) needing a room-id fix\n`,
		);

		let processed = 0;
		let roomIdFixed = 0;
		let markedReady = 0;
		let markedExpired = 0;
		let leftPending = 0;
		let skippedNoSchedule = 0;
		const templateCollisions = new Map<string, number>();

		const classLeadCache = new Map<string, number | null>();
		const resolveLead = async (classId: string): Promise<number> => {
			if (!classLeadCache.has(classId)) {
				const klass = await ClassModel.findById(classId)
					.select("occurrenceLeadMinutes")
					.lean();
				classLeadCache.set(classId, klass?.occurrenceLeadMinutes ?? null);
			}
			const override = classLeadCache.get(classId);
			return Number.isFinite(Number(override)) ? Number(override) : ROOM_LEAD_MINUTES;
		};

		const cursor = ScheduledSession.find(needsFix).batchSize(BATCH_SIZE).cursor();

		for await (const session of cursor) {
			processed++;

			if (session.videoRoomId && LAYOUT_TEMPLATE_STRINGS.has(session.videoRoomId)) {
				templateCollisions.set(
					session.videoRoomId,
					(templateCollisions.get(session.videoRoomId) ?? 0) + 1,
				);
			}

			const newRoomId = deriveRoomId(session._id);
			const start = combineSessionDateTime(session.sessionDate, session.startTime);
			const end = combineSessionDateTime(session.sessionDate, session.endTime);

			const update: Record<string, unknown> = { videoRoomId: newRoomId };

			if (!start) {
				// Unparseable schedule — fix the room id but leave lifecycle state
				// alone; resolveSessionAccess already fails these closed (NO_SCHEDULE).
				skippedNoSchedule++;
			} else if (session.status === "CANCELLED" || session.status === "COMPLETED") {
				// Not this script's job to resurrect a finished/cancelled session's
				// room state — only the id needs to stop colliding.
				leftPending++;
			} else {
				const leadMinutes = await resolveLead(String(session.classId));
				const timeline = buildRoomTimeline(start, end, leadMinutes);

				if (now >= timeline.roomExpiresAt) {
					update.roomStatus = "EXPIRED";
					update.roomReadyAt = timeline.roomReadyAt;
					update.roomExpiresAt = timeline.roomExpiresAt;
					markedExpired++;
				} else if (now >= timeline.roomReadyAt) {
					update.roomStatus = "READY";
					update.roomReadyAt = now;
					update.roomExpiresAt = timeline.roomExpiresAt;
					markedReady++;
				} else {
					// Lead time hasn't arrived — leave PENDING for the tick to pick up
					// normally; don't pre-compute roomExpiresAt for a room that isn't
					// provisioned yet.
					leftPending++;
				}
			}

			roomIdFixed++;

			if (!dryRun) {
				await ScheduledSession.updateOne({ _id: session._id }, { $set: update });
			}
		}

		console.log(
			`${dryRun ? "[dry-run] " : ""}Processed ${processed}: ` +
				`roomIdFixed=${roomIdFixed} markedReady=${markedReady} markedExpired=${markedExpired} ` +
				`leftPending=${leftPending} skippedNoSchedule=${skippedNoSchedule}`,
		);

		if (templateCollisions.size > 0) {
			console.log("\nLayout-template collisions found (rooms that were shared platform-wide):");
			for (const [template, count] of templateCollisions) {
				console.log(`  - "${template}": ${count} session(s)`);
			}
		}

		if (dryRun) {
			console.log("\nNo changes written. Re-run without --dry-run to apply.");
		}
	} catch (error) {
		console.error("Backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

main();
