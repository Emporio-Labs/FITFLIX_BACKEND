import { config } from "dotenv";
import mongoose from "mongoose";
import {
	AppointmentMode,
	ExpertType,
	MeetingStatus,
	ServiceCategory,
	ServiceSubtype,
	UnifiedBookingStatus,
} from "../src/models/Enums";
import ExpertSchedule from "../src/models/ExpertSchedule";
import NutritionistBooking from "../src/models/NutritionistBooking";
import UnifiedBooking from "../src/models/UnifiedBooking";
import { normalizeAppointmentModeOr } from "../src/utils/appointment-mode";
import { fromLegacyNutritionistStatus } from "../src/utils/nutritionist-booking.dto";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log(
		"Usage: bun run migrate:nutritionist-bookings [--dry-run] [--skip-horizon]",
	);
	console.log("  --dry-run        Report what would change without writing");
	console.log(
		"  --skip-horizon   Leave maxAdvanceBookingDays alone (see note below)",
	);
};

/**
 * Copies every `NutritionistBooking` into `UnifiedBooking` as an
 * `EXPERT_SESSION` / `NUTRITIONIST` row, and reconciles the booking horizon.
 *
 * Idempotent by construction: the destination row reuses the *source _id*, so a
 * second run finds it already there and skips it. Nothing is deleted — the old
 * collection is left intact as a rollback path, and `session-access.service.ts`
 * still falls back to it for any Zego room id already in flight. Drop it
 * manually once the migration has been verified in production.
 *
 * Horizon reconciliation: `maxAdvanceBookingDays` defaulted to 14 while the
 * member app's date picker allowed 60, and nothing enforced the field. Now that
 * `calculateAvailableSlots` does enforce it, leaving stored 14s in place would
 * silently shrink every existing expert's bookable window from 60 days to 14.
 * Existing schedules are raised to 60 to preserve the behaviour that was
 * actually live; pass --skip-horizon to opt out.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");
	const skipHorizon = hasFlag("--skip-horizon");

	await connectDB();

	const legacy = await NutritionistBooking.find({}).lean();
	console.log(`Found ${legacy.length} nutritionist booking(s) to migrate.`);

	let migrated = 0;
	let skipped = 0;
	let failed = 0;
	let malformed = 0;

	for (const row of legacy) {
		try {
			// A handful of rows in this collection predate even the current
			// NutritionistBooking schema (a much older shape with `user`/`date`/
			// `bookingStatus` instead of `userId`/`bookingDate`/`status`) and were
			// never backfilled when those fields were renamed. `insertOne` below
			// is a raw driver call that bypasses Mongoose's required-field
			// validation, so without this guard such a row would silently write a
			// UnifiedBooking with `userId: undefined` — corrupting every query
			// that filters by user. Report and skip instead.
			if (!row.userId || !row.bookingDate || !row.startTime || !row.endTime) {
				console.error(
					`  ⚠ ${String(row._id)} is missing required fields on the current schema (userId/bookingDate/startTime/endTime) — looks like a pre-rename legacy row. Skipping; needs manual review.`,
				);
				malformed++;
				continue;
			}

			const existing = await UnifiedBooking.findById(row._id).select("_id");
			if (existing) {
				skipped++;
				continue;
			}

			const status =
				fromLegacyNutritionistStatus(row.status) ?? UnifiedBookingStatus.PENDING;
			const mode = normalizeAppointmentModeOr(
				row.appointmentMode,
				AppointmentMode.ONLINE,
			);

			const doc = {
				_id: row._id,
				serviceCategory: ServiceCategory.EXPERT_SESSION,
				serviceSubtype: ServiceSubtype.NUTRITIONIST,
				userId: row.userId,
				slotId: row.slotId ?? null,
				bookingDate: row.bookingDate,
				startTime: row.startTime,
				endTime: row.endTime,
				appointmentMode: mode,
				// `clinicLocation` was free-text venue copy, which is exactly what
				// `location` is. `locationId` (the branch) was never captured, so it
				// stays null rather than being guessed.
				location:
					row.clinicLocation ??
					(mode === AppointmentMode.ONLINE ? "Online Video Room" : null),
				locationId: null,
				zegoRoomId: row.zegoRoomId ?? null,
				expertId: row.assignedNutritionistId ?? null,
				expertModel: "User" as const,
				assignedExpertName: row.assignedNutritionistName ?? "",
				meetingStatus: row.meetingStatus ?? MeetingStatus.SCHEDULED,
				status,
				memberNotes: row.notes ?? null,
				hostLiveAt: row.hostLiveAt ?? null,
				hostLastSeenAt: row.hostLastSeenAt ?? null,
				acceptedAt: row.acceptedAt ?? null,
				completedAt: row.completedAt ?? null,
				cancelledAt: row.cancelledAt ?? null,
				cancelledBy: row.cancelledBy ?? null,
				cancellationReason: row.cancellationReason ?? null,
				// A consultation is not drawn from a PT package quota.
				consumptionModel: "CREDIT_POOL" as const,
				creditCostSnapshot: 0,
				creditsBypassed: true,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			};

			if (dryRun) {
				console.log(
					`  [dry-run] ${String(row._id)}  ${row.status} → ${status}  ${
						row.bookingDate?.toISOString().slice(0, 10) ?? "?"
					} ${row.startTime}`,
				);
				migrated++;
				continue;
			}

			// timestamps:true would otherwise overwrite createdAt/updatedAt with
			// "now", losing the ordering every `.sort({createdAt:-1})` depends on.
			await UnifiedBooking.collection.insertOne(doc as never);
			migrated++;
		} catch (err) {
			// A duplicate-key error here means two legacy rows put the same
			// nutritionist in the same slot — a double-booking that the old model
			// could not prevent and the new one refuses. Report it rather than
			// silently dropping one.
			if ((err as { code?: number }).code === 11000) {
				console.error(
					`  ✗ ${String(row._id)} collides with an existing booking for the same expert/date/time — resolve by hand.`,
				);
			} else {
				console.error(`  ✗ ${String(row._id)} failed:`, err);
			}
			failed++;
		}
	}

	console.log(
		`\nBookings — migrated: ${migrated}, already present: ${skipped}, failed: ${failed}, malformed (skipped): ${malformed}`,
	);

	if (!skipHorizon) {
		const horizonFilter = { maxAdvanceBookingDays: { $lt: 60 } };
		const affected = await ExpertSchedule.countDocuments(horizonFilter);
		if (dryRun) {
			console.log(
				`[dry-run] Would raise maxAdvanceBookingDays to 60 on ${affected} schedule(s).`,
			);
		} else if (affected > 0) {
			await ExpertSchedule.updateMany(horizonFilter, {
				$set: { maxAdvanceBookingDays: 60 },
			});
			console.log(
				`Raised maxAdvanceBookingDays to 60 on ${affected} schedule(s).`,
			);
		} else {
			console.log("No schedules needed a horizon change.");
		}
	}

	// Every schedule written before `expertType` was wired through defaulted to
	// Trainer. Nothing to fix for trainers; this only reports so a stray
	// mistyped row is visible rather than silently excluded from its own pool.
	const nutritionistSchedules = await ExpertSchedule.countDocuments({
		expertType: ExpertType.Nutritionist,
	});
	console.log(
		`Nutritionist schedules present: ${nutritionistSchedules}. ` +
			"Each nutritionist needs one (and a `staffRole: \"nutritionist\"` User) " +
			"before pooled availability returns anything.",
	);

	if (dryRun) {
		console.log("\nDry run — nothing was written.");
	}
}

main()
	.then(async () => {
		await mongoose.connection.close();
		process.exit(0);
	})
	.catch(async (err) => {
		console.error("Migration failed:", err);
		await mongoose.connection.close();
		process.exit(1);
	});
