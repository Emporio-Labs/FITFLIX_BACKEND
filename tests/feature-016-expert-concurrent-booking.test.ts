import mongoose from "mongoose";
import { AppointmentMode, ExpertType } from "../src/models/Enums";
import ExpertAppointment from "../src/models/ExpertAppointment";
import ExpertSchedule from "../src/models/ExpertSchedule";
import UnifiedBooking from "../src/models/UnifiedBooking";
import User from "../src/models/User";
import {
	getOrCreateExpertSchedule,
	updateExpertSchedule,
} from "../src/services/expert-schedule.service";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

/**
 * Proves (or disproves) the concurrency claim in expert-schedule.service.ts's
 * pickExpertForSlot doc comment: "makes double-booking structurally
 * impossible ... UnifiedBooking's partial unique index on
 * {expertId, bookingDate, startTime} catches the concurrent case."
 *
 * That guard exists for Nutritionist/Trainer because they write to
 * UnifiedBooking. Sports Scientist writes to ExpertAppointment instead,
 * which has no equivalent unique index — this test fires two truly
 * simultaneous bookings at the same expert/date/time for both flows and
 * reports what actually happens to each.
 */

const ONE_DAY = 86400000;

async function seedExpert(expertType: ExpertType, email: string) {
	const user = await User.findOneAndUpdate(
		{ email },
		{
			$set: {
				username: "Concurrency Test Expert",
				phone: `9${Date.now().toString().slice(-9)}`,
				age: 30,
				gender: "Other",
				staffRole: expertType,
				isActive: true,
				passwordHash: "test-hash-not-used",
			},
		},
		{ upsert: true, new: true, setDefaultsOnInsert: true },
	);
	const userId = user._id.toString();

	await getOrCreateExpertSchedule(userId, expertType);
	await updateExpertSchedule(
		userId,
		{
			weeklySlots: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
				dayOfWeek,
				isAvailable: true,
				startTime: "00:00",
				endTime: "23:00",
			})),
			slotDurationMinutes: 45,
			bufferMinutes: 15,
			supportedModes: [AppointmentMode.IN_PERSON, AppointmentMode.ONLINE],
			maxAdvanceBookingDays: 60,
			isActive: true,
		},
		expertType,
	);

	return userId;
}

async function runTests() {
	console.log(
		"=== FEATURE-016: Concurrent double-booking — Nutritionist vs Sports Scientist ===",
	);
	const { baseUrl, close } = await startTestServer();

	const memberAId = new mongoose.Types.ObjectId().toString();
	const memberBId = new mongoose.Types.ObjectId().toString();
	const memberAToken = generateTestToken("user", memberAId);
	const memberBToken = generateTestToken("user", memberBId);

	const targetDate = new Date(Date.now() + ONE_DAY * 3);
	const dateIso = targetDate.toISOString().slice(0, 10);
	const startTime = "11:00";
	const endTime = "11:45";

	let nutritionistExpertId = "";
	let sportsScientistExpertId = "";

	try {
		console.log("\n--- Scenario A: Nutritionist (writes to UnifiedBooking) ---");
		nutritionistExpertId = await seedExpert(
			ExpertType.Nutritionist,
			"concurrency-nutritionist@fitflix.test",
		);

		const [nutriA, nutriB] = await Promise.all([
			fetchJson(baseUrl, "/onboarding/nutritionist/book", {
				method: "POST",
				token: memberAToken,
				body: { date: dateIso, startTime, endTime, appointmentMode: "IN_PERSON" },
			}),
			fetchJson(baseUrl, "/onboarding/nutritionist/book", {
				method: "POST",
				token: memberBToken,
				body: { date: dateIso, startTime, endTime, appointmentMode: "IN_PERSON" },
			}),
		]);

		console.log(`  Member A response: ${nutriA.status}`);
		console.log(`  Member B response: ${nutriB.status}`);

		const nutriStatuses = [nutriA.status, nutriB.status].sort();
		assert(
			JSON.stringify(nutriStatuses) === JSON.stringify([201, 409]),
			`Exactly one booking succeeds (201) and the other is rejected (409) — got ${nutriStatuses}`,
		);

		const nutriBookingsAtThatSlot = await UnifiedBooking.countDocuments({
			expertId: nutritionistExpertId,
			bookingDate: {
				$gte: new Date(dateIso + "T00:00:00.000Z"),
				$lt: new Date(dateIso + "T23:59:59.999Z"),
			},
			startTime,
		});
		assert(
			nutriBookingsAtThatSlot === 1,
			`Exactly one UnifiedBooking row exists for this expert/date/time (found ${nutriBookingsAtThatSlot})`,
		);

		console.log(
			"\n--- Scenario B: Sports Scientist (writes to ExpertAppointment) ---",
		);
		sportsScientistExpertId = await seedExpert(
			ExpertType.SportsScientist,
			"concurrency-sportsci@fitflix.test",
		);

		const [ssA, ssB] = await Promise.all([
			fetchJson(baseUrl, "/onboarding/sports-scientist", {
				method: "POST",
				token: memberAToken,
				body: {
					appointmentDate: targetDate.toISOString(),
					startTime,
					endTime,
					appointmentMode: "IN_PERSON",
				},
			}),
			fetchJson(baseUrl, "/onboarding/sports-scientist", {
				method: "POST",
				token: memberBToken,
				body: {
					appointmentDate: targetDate.toISOString(),
					startTime,
					endTime,
					appointmentMode: "IN_PERSON",
				},
			}),
		]);

		console.log(`  Member A response: ${ssA.status}`);
		console.log(`  Member B response: ${ssB.status}`);

		const ssAppointments = await ExpertAppointment.find({
			userId: { $in: [memberAId, memberBId] },
			expertType: ExpertType.SportsScientist,
		}).lean();

		console.log(
			`  ExpertAppointment rows created: ${ssAppointments.length}`,
		);
		for (const appt of ssAppointments) {
			console.log(
				`    user=${appt.userId} assignedExpertId=${appt.assignedExpertId} startTime=${appt.startTime} status=${appt.bookingStatus}`,
			);
		}

		const bothSucceeded = ssA.status === 201 && ssB.status === 201;
		const sameExpertSameTime =
			ssAppointments.length === 2 &&
			String(ssAppointments[0].assignedExpertId) ===
				String(ssAppointments[1].assignedExpertId) &&
			ssAppointments[0].startTime === ssAppointments[1].startTime;

		if (bothSucceeded && sameExpertSameTime) {
			console.log(
				"  ⚠️  CONFIRMED GAP: both members were accepted (201/201) for the SAME sports scientist at the SAME time — nothing in this path rejected the second request.",
			);
		} else if (bothSucceeded) {
			console.log(
				"  Both succeeded but were not assigned identically — no collision observed this run.",
			);
		} else {
			console.log(
				"  One request was rejected — no gap observed this run (re-run a few times; this path has no structural guard, so outcomes can vary under load).",
			);
		}
	} finally {
		await UnifiedBooking.deleteMany({
			userId: { $in: [memberAId, memberBId] },
		});
		await ExpertAppointment.deleteMany({
			userId: { $in: [memberAId, memberBId] },
		});
		await ExpertSchedule.deleteMany({
			expertId: {
				$in: [nutritionistExpertId, sportsScientistExpertId].filter(Boolean),
			},
		});
		await User.deleteMany({
			email: {
				$in: [
					"concurrency-nutritionist@fitflix.test",
					"concurrency-sportsci@fitflix.test",
				],
			},
		});
		await close();
		await mongoose.connection.close();
	}

	console.log("\n=== FEATURE-016 tests complete ===");
}

runTests().catch((err) => {
	console.error("Test run failed:", err);
	process.exitCode = 1;
});
