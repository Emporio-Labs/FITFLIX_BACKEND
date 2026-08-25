import mongoose from "mongoose";
import { Gender, NutritionistBookingStatus, UserStatus } from "../src/models/Enums";
import NutritionistBooking from "../src/models/NutritionistBooking";
import Slot from "../src/models/Slots";
import User from "../src/models/User";
import { BUSINESS_TIMEZONE } from "../src/utils/zego-room";
import { formatDateInZone, formatTimeInZone } from "../src/utils/timezone.util";
import { assert, fetchJson, generateTestToken, startTestServer } from "./test-helpers";

/**
 * Covers the N2 self-service cancel/reschedule work:
 *   - cancel outside the window succeeds and frees slot capacity
 *   - cancel inside the window returns 409 CANCELLATION_WINDOW_CLOSED
 *   - reschedule from PENDING and from ACCEPTED now succeeds (previously
 *     only RESCHEDULE_REQUIRED could reschedule)
 *   - reschedule from PENDING inside the window returns 409
 *     RESCHEDULE_WINDOW_CLOSED
 *   - reschedule from RESCHEDULE_REQUIRED ignores the cutoff — that state is
 *     staff-forced and must stay reschedulable at any time
 *
 * `bookingDate` is stored as a UTC-midnight Date whose *UTC calendar date* is
 * read as the intended BUSINESS_TIMEZONE calendar day (see
 * combineSessionDateTime's doc comment in src/utils/zego-room.ts), and
 * `startTime`/`endTime` are business-timezone wall-clock "HH:mm" strings —
 * not UTC. [zonedParts] below derives both from a target instant the same
 * way the app does, so a booking "3 hours from now" actually resolves to an
 * instant 3 hours from now instead of drifting by the zone offset.
 */
function zonedParts(instant: Date): { bookingDate: Date; hhmm: string } {
	const dateStr = formatDateInZone(instant, BUSINESS_TIMEZONE); // "YYYY-MM-DD"
	const [y, m, d] = dateStr.split("-").map(Number);
	return {
		bookingDate: new Date(Date.UTC(y as number, (m as number) - 1, d as number)),
		hhmm: formatTimeInZone(instant, BUSINESS_TIMEZONE),
	};
}

async function runNutritionistBookingCancelRescheduleTests() {
	console.log("=== Feature Test: Nutritionist Booking Cancel/Reschedule ===");
	const { baseUrl, close } = await startTestServer();

	let memberId = "";
	let memberToken = "";
	const bookingIds: string[] = [];
	const slotIds: string[] = [];

	const HOUR = 3_600_000;

	const makeSlot = async (opts: {
		at: Date;
		durationMinutes?: number;
		remainingCapacity: number;
	}) => {
		const { bookingDate, hhmm } = zonedParts(opts.at);
		const end = new Date(opts.at.getTime() + (opts.durationMinutes ?? 30) * 60_000);
		const slot = await Slot.create({
			date: bookingDate,
			isDaily: false,
			startTime: hhmm,
			endTime: zonedParts(end).hhmm,
			capacity: 1,
			remainingCapacity: opts.remainingCapacity,
			isBooked: opts.remainingCapacity <= 0,
		});
		slotIds.push(slot._id.toString());
		return slot;
	};

	const makeBooking = async (opts: {
		status: NutritionistBookingStatus;
		startsInMs: number;
		durationMinutes?: number;
		slotId?: mongoose.Types.ObjectId | null;
	}) => {
		const start = new Date(Date.now() + opts.startsInMs);
		const end = new Date(start.getTime() + (opts.durationMinutes ?? 30) * 60_000);
		const { bookingDate, hhmm: startTime } = zonedParts(start);
		const booking = await NutritionistBooking.create({
			userId: new mongoose.Types.ObjectId(memberId),
			slotId: opts.slotId ?? null,
			bookingDate,
			startTime,
			endTime: zonedParts(end).hhmm,
			appointmentMode: "ONLINE",
			meetingStatus: "SCHEDULED",
			status: opts.status,
		});
		bookingIds.push(booking._id.toString());
		return booking;
	};

	try {
		console.log("\n1. Creating test member...");
		const member = await User.create({
			username: "nutri_cancel_member",
			email: "nutri.cancel@fitflix.test",
			phone: "+12345677199",
			gender: Gender.Male,
			age: 28,
			passwordHash: "hash123",
			firstName: "Nutri",
			lastName: "Cancel",
			role: "user",
			status: UserStatus.Active,
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		memberId = member._id.toString();
		memberToken = generateTestToken("user", memberId);

		console.log("\n2. Cancel outside the window succeeds and frees slot capacity...");
		const cancelAt = new Date(Date.now() + 3 * HOUR);
		const cancelSlot = await makeSlot({ at: cancelAt, remainingCapacity: 0 });
		const cancellableBooking = await makeBooking({
			status: NutritionistBookingStatus.PENDING,
			startsInMs: 3 * HOUR,
			slotId: cancelSlot._id,
		});
		const cancelRes = await fetchJson(baseUrl, "/nutritionist/my-booking/cancel", {
			method: "PATCH",
			token: memberToken,
			body: { reason: "Can't make it" },
		});
		assert(cancelRes.status === 200, "Cancel outside window returns 200");
		assert(
			cancelRes.data?.booking?.status === "CANCELLED",
			"Booking status flips to CANCELLED",
		);
		assert(cancelRes.data?.booking?.cancelledBy === "user", "cancelledBy is stamped 'user'");
		assert(!!cancelRes.data?.booking?.cancelledAt, "cancelledAt is stamped");
		const releasedSlot = await Slot.findById(cancelSlot._id).lean();
		assert(
			releasedSlot?.remainingCapacity === 1,
			"Cancelling releases the slot's held capacity",
		);
		const persisted = await NutritionistBooking.findById(cancellableBooking._id).lean();
		assert(
			persisted?.status === NutritionistBookingStatus.CANCELLED,
			"Cancelled status persists to the DB",
		);

		console.log("\n3. Cancel inside the 2h window is rejected...");
		await makeBooking({
			status: NutritionistBookingStatus.PENDING,
			startsInMs: 30 * 60_000, // 30 min out — inside the 2h cutoff
		});
		const closeCancelRes = await fetchJson(baseUrl, "/nutritionist/my-booking/cancel", {
			method: "PATCH",
			token: memberToken,
			body: {},
		});
		assert(closeCancelRes.status === 409, "Cancel inside window returns 409");
		assert(
			closeCancelRes.data?.code === "CANCELLATION_WINDOW_CLOSED",
			"Error code is CANCELLATION_WINDOW_CLOSED",
		);

		console.log("\n4. Reschedule from PENDING now succeeds...");
		// Move the still-PENDING booking from step 3 out of the way — the
		// controller always targets the caller's single latest active booking.
		await NutritionistBooking.findByIdAndUpdate(bookingIds[bookingIds.length - 1], {
			status: NutritionistBookingStatus.CANCELLED,
		});
		const pendingOldAt = new Date(Date.now() + 4 * HOUR);
		const pendingOldSlot = await makeSlot({ at: pendingOldAt, remainingCapacity: 0 });
		await makeBooking({
			status: NutritionistBookingStatus.PENDING,
			startsInMs: 4 * HOUR,
			slotId: pendingOldSlot._id,
		});
		const pendingNewAt = new Date(Date.now() + 5 * HOUR);
		const pendingNewSlot = await makeSlot({ at: pendingNewAt, remainingCapacity: 1 });
		const rescheduleFromPending = await fetchJson(
			baseUrl,
			"/nutritionist/my-booking/reschedule",
			{
				method: "PATCH",
				token: memberToken,
				body: {
					slotId: pendingNewSlot._id.toString(),
					date: formatDateInZone(pendingNewAt, BUSINESS_TIMEZONE),
				},
			},
		);
		assert(rescheduleFromPending.status === 200, "Reschedule from PENDING returns 200");
		assert(
			rescheduleFromPending.data?.booking?.status === "PENDING",
			"Rescheduled booking is PENDING, awaiting re-acceptance",
		);
		assert(
			rescheduleFromPending.data?.booking?.slotId === pendingNewSlot._id.toString(),
			"Booking now points at the new slot",
		);
		const freedOldSlot = await Slot.findById(pendingOldSlot._id).lean();
		assert(freedOldSlot?.remainingCapacity === 1, "Old slot capacity released");
		const takenNewSlot = await Slot.findById(pendingNewSlot._id).lean();
		assert(takenNewSlot?.remainingCapacity === 0, "New slot capacity reserved");

		console.log("\n5. Reschedule from ACCEPTED now succeeds...");
		await NutritionistBooking.findByIdAndUpdate(bookingIds[bookingIds.length - 1], {
			status: NutritionistBookingStatus.ACCEPTED,
		});
		const acceptedNewAt = new Date(Date.now() + 6 * HOUR);
		const acceptedNewSlot = await makeSlot({ at: acceptedNewAt, remainingCapacity: 1 });
		const rescheduleFromAccepted = await fetchJson(
			baseUrl,
			"/nutritionist/my-booking/reschedule",
			{
				method: "PATCH",
				token: memberToken,
				body: {
					slotId: acceptedNewSlot._id.toString(),
					date: formatDateInZone(acceptedNewAt, BUSINESS_TIMEZONE),
				},
			},
		);
		assert(rescheduleFromAccepted.status === 200, "Reschedule from ACCEPTED returns 200");
		assert(
			rescheduleFromAccepted.data?.booking?.status === "PENDING",
			"Rescheduling an ACCEPTED booking returns it to PENDING",
		);

		console.log("\n6. Reschedule from PENDING inside the window is rejected...");
		const closeAt = new Date(Date.now() + 30 * 60_000);
		const { bookingDate: closeBookingDate, hhmm: closeStartTime } = zonedParts(closeAt);
		await NutritionistBooking.findByIdAndUpdate(bookingIds[bookingIds.length - 1], {
			status: NutritionistBookingStatus.PENDING,
			bookingDate: closeBookingDate,
			startTime: closeStartTime,
		});
		const closeSlot = await makeSlot({
			at: new Date(Date.now() + 8 * HOUR),
			remainingCapacity: 1,
		});
		const closeReschedule = await fetchJson(baseUrl, "/nutritionist/my-booking/reschedule", {
			method: "PATCH",
			token: memberToken,
			body: { slotId: closeSlot._id.toString() },
		});
		assert(closeReschedule.status === 409, "Reschedule inside window returns 409");
		assert(
			closeReschedule.data?.code === "RESCHEDULE_WINDOW_CLOSED",
			"Error code is RESCHEDULE_WINDOW_CLOSED",
		);

		console.log("\n7. Reschedule from RESCHEDULE_REQUIRED ignores the cutoff...");
		await NutritionistBooking.findByIdAndUpdate(bookingIds[bookingIds.length - 1], {
			status: NutritionistBookingStatus.RESCHEDULE_REQUIRED,
		});
		const forcedNewAt = new Date(Date.now() + 9 * HOUR);
		const forcedNewSlot = await makeSlot({ at: forcedNewAt, remainingCapacity: 1 });
		const rescheduleFromForced = await fetchJson(
			baseUrl,
			"/nutritionist/my-booking/reschedule",
			{
				method: "PATCH",
				token: memberToken,
				body: {
					slotId: forcedNewSlot._id.toString(),
					date: formatDateInZone(forcedNewAt, BUSINESS_TIMEZONE),
				},
			},
		);
		assert(
			rescheduleFromForced.status === 200,
			"Reschedule from RESCHEDULE_REQUIRED succeeds even inside the window",
		);

		console.log("\n🎉 Nutritionist Booking Cancel/Reschedule Tests Passed!");
	} finally {
		if (memberId) await User.findByIdAndDelete(memberId);
		if (bookingIds.length > 0) {
			await NutritionistBooking.deleteMany({ _id: { $in: bookingIds } });
		}
		if (slotIds.length > 0) {
			await Slot.deleteMany({ _id: { $in: slotIds } });
		}
		await close();
	}
}

runNutritionistBookingCancelRescheduleTests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Nutritionist booking cancel/reschedule test failed:", err);
		process.exit(1);
	});
