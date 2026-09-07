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
import ExpertAppointment from "../src/models/ExpertAppointment";
import UnifiedBooking from "../src/models/UnifiedBooking";
import { normalizeAppointmentModeOr } from "../src/utils/appointment-mode";
import { fromLegacySportsScientistStatus } from "../src/utils/sports-scientist-booking.dto";
import { normalizeBookingDate, ssRoomIdFor } from "../src/utils/zego-room";
import connectDB from "../src/utils/db";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run migrate:sports-scientist-bookings [--dry-run]");
	console.log("  --dry-run   Report what would change without writing");
};

/**
 * Copies every sports-scientist `ExpertAppointment` into `UnifiedBooking` as
 * an `EXPERT_SESSION` / `SPORTS_SCIENTIST` row, mirroring
 * migrate-nutritionist-bookings.ts exactly.
 *
 * Idempotent by construction: the destination row reuses the *source _id*, so
 * a second run finds it already there and skips it. Nothing is deleted — the
 * old collection is left intact as a rollback path, and
 * session-access.service.ts still falls back to it for any `ss_session_`
 * Zego room id already in flight (see the `ssRoomIdFor` prefix stripping
 * added alongside `nutri_session_`).
 *
 * `ExpertAppointment.startTime`/`endTime` are nullable (a booking made with
 * no `slotId` never got a concrete time), but `UnifiedBooking` requires both
 * — a booking with no time has no join window (combineSessionWindow returns
 * null, resolveSessionAccess denies NO_SCHEDULE), so it could never have
 * hosted a video call anyway. Such rows are reported and skipped rather than
 * given a fabricated time; front-desk staff should reject them from the
 * queue so the member is prompted to rebook (rejectBooking already resets
 * their onboarding step for exactly that).
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	await connectDB();

	const legacy = await ExpertAppointment.find({
		expertType: ExpertType.SportsScientist,
	}).lean();
	console.log(`Found ${legacy.length} sports-scientist booking(s) to migrate.`);

	let migrated = 0;
	let skipped = 0;
	let failed = 0;
	let malformed = 0;

	for (const row of legacy) {
		try {
			if (!row.userId || !row.appointmentDate || !row.startTime || !row.endTime) {
				console.error(
					`  ⚠ ${String(row._id)} has no startTime/endTime (a slot-less legacy booking) — cannot satisfy UnifiedBooking's required fields. Skipping; reject it from the admin queue so the member rebooks.`,
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
				fromLegacySportsScientistStatus(row.bookingStatus) ??
				UnifiedBookingStatus.PENDING;
			const mode = normalizeAppointmentModeOr(
				row.appointmentMode,
				AppointmentMode.IN_PERSON,
			);
			const isLiveRoom =
				mode === AppointmentMode.ONLINE &&
				status !== UnifiedBookingStatus.REJECTED &&
				status !== UnifiedBookingStatus.CANCELLED;

			const doc = {
				_id: row._id,
				serviceCategory: ServiceCategory.EXPERT_SESSION,
				serviceSubtype: ServiceSubtype.SPORTS_SCIENTIST,
				userId: row.userId,
				slotId: row.slotId ?? null,
				bookingDate: normalizeBookingDate(row.appointmentDate),
				startTime: row.startTime,
				endTime: row.endTime,
				appointmentMode: mode,
				// `clinicLocation` was free-text venue copy, which is exactly what
				// `location` is. `locationId` (the branch) was never captured on
				// ExpertAppointment, so it stays null rather than being guessed.
				location:
					row.clinicLocation ??
					(mode === AppointmentMode.ONLINE ? "Online Video Room" : null),
				locationId: null,
				// Backfill a room id for any booking that could still host a call —
				// a rejected or cancelled one never will, so it is left without one
				// rather than minting a room nobody can join.
				zegoRoomId: isLiveRoom ? ssRoomIdFor(row._id) : null,
				expertId: row.assignedExpertId ?? null,
				expertModel: "User" as const,
				assignedExpertName: row.assignedExpertName ?? "",
				meetingStatus: row.meetingStatus ?? MeetingStatus.SCHEDULED,
				status,
				memberNotes: row.notes ?? null,
				acceptedAt: row.acceptedAt ?? null,
				completedAt: row.completedAt ?? null,
				rejectedAt: row.rejectedAt ?? null,
				rejectionReason: row.rejectionReason ?? null,
				// A consultation is not drawn from a PT package quota.
				consumptionModel: "CREDIT_POOL" as const,
				creditCostSnapshot: 0,
				creditsBypassed: true,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			};

			if (dryRun) {
				console.log(
					`  [dry-run] ${String(row._id)}  ${row.bookingStatus} → ${status}  ${
						doc.bookingDate.toISOString().slice(0, 10)
					} ${row.startTime}${isLiveRoom ? `  room=${ssRoomIdFor(row._id)}` : ""}`,
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
			// sports scientist in the same slot — a double-booking the old model
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
