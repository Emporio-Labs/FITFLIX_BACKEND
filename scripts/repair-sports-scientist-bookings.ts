import { config } from "dotenv";
import mongoose from "mongoose";
import {
	ServiceCategory,
	ServiceSubtype,
	UnifiedBookingStatus,
} from "../src/models/Enums";
import UnifiedBooking from "../src/models/UnifiedBooking";
import { reserveSlotCapacity } from "../src/services/slot-reservation.service";
import connectDB from "../src/utils/db";
import { normalizeBookingDate } from "../src/utils/zego-room";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

const printUsage = () => {
	console.log("Usage: bun run scripts/repair-sports-scientist-bookings.ts [--dry-run]");
	console.log("  --dry-run   Report what would change without writing");
};

/**
 * Repairs sports-scientist consultations on `UnifiedBooking` that were created
 * during the testing window and incorrectly flipped to `RESCHEDULE_REQUIRED`
 * because of the 18:30Z date shift.
 *
 * For each affected row:
 * 1. Pins `bookingDate` to UTC midnight of its business calendar day via `normalizeBookingDate`.
 * 2. Moves `status` back to `PENDING`.
 * 3. Re-reserves slot capacity if a `slotId` was associated with the booking.
 */
async function main() {
	if (hasFlag("--help") || hasFlag("-h")) {
		printUsage();
		return;
	}

	const dryRun = hasFlag("--dry-run");

	await connectDB();

	// Scope strictly to the recent testing window so legacy unmigrated data is untouched.
	const testingWindowStart = new Date("2026-09-01T00:00:00.000Z");

	const affectedRows = await UnifiedBooking.find({
		serviceCategory: ServiceCategory.EXPERT_SESSION,
		serviceSubtype: ServiceSubtype.SPORTS_SCIENTIST,
		status: UnifiedBookingStatus.RESCHEDULE_REQUIRED,
		createdAt: { $gte: testingWindowStart },
	});

	console.log(
		`Found ${affectedRows.length} affected sports-scientist booking(s) to repair.`,
	);

	let repaired = 0;
	let failed = 0;

	for (const row of affectedRows) {
		try {
			const originalDate = row.bookingDate;
			const normalizedDate = normalizeBookingDate(originalDate);

			if (dryRun) {
				console.log(
					`  [dry-run] ${String(row._id)}: status ${row.status} → PENDING, ` +
						`bookingDate ${originalDate?.toISOString()} → ${normalizedDate.toISOString()}` +
						(row.slotId ? ` (re-reserve slot ${String(row.slotId)})` : " (no slot)"),
				);
				repaired++;
				continue;
			}

			if (row.slotId) {
				try {
					await reserveSlotCapacity(row.slotId.toString());
					console.log(`  Re-reserved slot capacity for slot ${String(row.slotId)}`);
				} catch (slotErr) {
					console.warn(
						`  ⚠ Could not re-reserve slot ${String(row.slotId)} for booking ${String(row._id)}:`,
						slotErr,
					);
				}
			}

			row.bookingDate = normalizedDate;
			row.status = UnifiedBookingStatus.PENDING;
			await row.save();

			console.log(
				`  ✅ Repaired ${String(row._id)}: ${originalDate?.toISOString()} → ${normalizedDate.toISOString()} (PENDING)`,
			);
			repaired++;
		} catch (err) {
			console.error(`  ❌ Failed to repair booking ${String(row._id)}:`, err);
			failed++;
		}
	}

	console.log(`\nDone. Repaired: ${repaired}, Failed: ${failed}${dryRun ? " (dry run)" : ""}`);
	await mongoose.connection.close();
}

main().catch(async (err) => {
	console.error("Repair script failed:", err);
	await mongoose.connection.close().catch(() => {});
	process.exit(1);
});
