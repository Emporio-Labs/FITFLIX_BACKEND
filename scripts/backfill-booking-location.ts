import { config } from "dotenv";
import mongoose from "mongoose";
import Booking from "../src/models/Bookings";
import Class from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import Slot from "../src/models/Slots";
import User from "../src/models/User";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run backfill:booking-location [--dry-run]");
	console.log("  --dry-run   Show what would change without writing updates");
};

/**
 * FX-18 — stamp a `locationId` on legacy bookings.
 *
 * The legacy Booking model never carried a branch, so branch-scoped staff can't
 * be confined to their branches' bookings until every row has one. New bookings
 * are stamped on create (slot/class); this script resolves the branch for the
 * rows that predate that, in order of reliability:
 *
 *   1. slot      → Slot.locationId         (slot/service bookings)
 *   2. classId   → Class.locationId        (group-class bookings)
 *   3. sessionId → ScheduledSession.classId → Class.locationId
 *   4. user      → User.homeLocationId      (last-resort fallback)
 *
 * A booking that still can't be resolved is left null (and stays hidden from
 * branch staff, per FX-18 decision 2) and reported at the end. Idempotent: only
 * rows missing `locationId` are considered, so it is safe to re-run.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}
	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();

		const filter = {
			$or: [{ locationId: { $exists: false } }, { locationId: null }],
		};

		type BookingShape = {
			_id: mongoose.Types.ObjectId;
			slot?: mongoose.Types.ObjectId | null;
			classId?: string | null;
			sessionId?: string | null;
			user?: mongoose.Types.ObjectId | null;
		};

		const bookings = (await Booking.find(filter)
			.select("_id slot classId sessionId user")
			.lean()) as BookingShape[];

		console.log(`Bookings missing locationId: ${bookings.length}`);
		if (bookings.length === 0) {
			console.log("No migration needed.");
			return;
		}

		// Batch-load the related documents once, then resolve each booking in memory.
		const slotIds = [
			...new Set(bookings.map((b) => b.slot).filter(Boolean).map(String)),
		];
		const classIds = [
			...new Set(bookings.map((b) => b.classId).filter(Boolean).map(String)),
		];
		const sessionIds = [
			...new Set(bookings.map((b) => b.sessionId).filter(Boolean).map(String)),
		];
		const userIds = [
			...new Set(bookings.map((b) => b.user).filter(Boolean).map(String)),
		];

		const [slots, sessions, users] = await Promise.all([
			slotIds.length
				? Slot.find({ _id: { $in: slotIds } }).select("_id locationId").lean()
				: [],
			sessionIds.length
				? ScheduledSession.find({ _id: { $in: sessionIds } })
						.select("_id classId")
						.lean()
				: [],
			userIds.length
				? User.find({ _id: { $in: userIds } })
						.select("_id homeLocationId")
						.lean()
				: [],
		]);

		const slotLoc = new Map(
			slots.map((s: any) => [String(s._id), s.locationId ? String(s.locationId) : null]),
		);
		const sessionClass = new Map(
			sessions.map((s: any) => [String(s._id), s.classId ? String(s.classId) : null]),
		);
		const userHome = new Map(
			users.map((u: any) => [
				String(u._id),
				u.homeLocationId ? String(u.homeLocationId) : null,
			]),
		);

		// Classes referenced directly OR via a session.
		const allClassIds = [
			...new Set([
				...classIds,
				...[...sessionClass.values()].filter(Boolean).map(String),
			]),
		];
		const classes = allClassIds.length
			? await Class.find({ _id: { $in: allClassIds } })
					.select("_id locationId")
					.lean()
			: [];
		const classLoc = new Map(
			classes.map((c: any) => [String(c._id), c.locationId ? String(c.locationId) : null]),
		);

		const resolveBranch = (b: BookingShape): string | null => {
			if (b.slot) {
				const loc = slotLoc.get(String(b.slot));
				if (loc) return loc;
			}
			if (b.classId) {
				const loc = classLoc.get(String(b.classId));
				if (loc) return loc;
			}
			if (b.sessionId) {
				const classId = sessionClass.get(String(b.sessionId));
				if (classId) {
					const loc = classLoc.get(String(classId));
					if (loc) return loc;
				}
			}
			if (b.user) {
				const loc = userHome.get(String(b.user));
				if (loc) return loc;
			}
			return null;
		};

		const ops: mongoose.AnyBulkWriteOperation[] = [];
		let unresolved = 0;
		for (const b of bookings) {
			const branch = resolveBranch(b);
			if (!branch) {
				unresolved += 1;
				continue;
			}
			ops.push({
				updateOne: {
					filter: { _id: b._id },
					update: { $set: { locationId: new mongoose.Types.ObjectId(branch) } },
				},
			});
		}

		console.log(`Resolvable: ${ops.length}, unresolved (left null): ${unresolved}`);

		if (dryRun) {
			console.log("Dry run complete. No database changes were applied.");
			return;
		}

		if (ops.length > 0) {
			const result = await Booking.bulkWrite(ops);
			console.log("Migration complete.");
			console.log(`Modified documents: ${result.modifiedCount}`);
		} else {
			console.log("Nothing to update.");
		}
		if (unresolved > 0) {
			console.log(
				`${unresolved} booking(s) could not be resolved and remain null — ` +
					"these stay hidden from branch-scoped staff until linked to a branch.",
			);
		}
	} catch (error) {
		console.error("Booking locationId backfill failed:", error);
		process.exitCode = 1;
	} finally {
		await mongoose.disconnect();
	}
}

await main();
