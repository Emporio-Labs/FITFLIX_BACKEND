import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import FitflixEvent from "../src/models/FitflixEvent";
import EventRegistration from "../src/models/EventRegistration";
import { EventStatus, EventType, RegistrationPaymentStatus } from "../src/models/Enums";
import { verifyEventCheckIn } from "../src/controllers/event.controller";
import type { Request, Response } from "express";

config();

function createMockReqRes(body: any, user: any = { id: new mongoose.Types.ObjectId().toString(), role: "admin" }) {
	let statusCode = 200;
	let responseData: any = null;

	const req = {
		body,
		user,
	} as unknown as Request;

	const res = {
		status: (code: number) => {
			statusCode = code;
			return res;
		},
		json: (data: any) => {
			responseData = data;
			return res;
		},
	} as unknown as Response;

	const next = (err: any) => {
		if (err) throw err;
	};

	return {
		req,
		res,
		next,
		getResult: () => ({ statusCode, responseData }),
	};
}

async function runCheckInVerificationTests() {
	console.log("====================================================");
	console.log("FITFLIX EVENTS: LIVE QR SCANNER & CHECK-IN TEST SUITE");
	console.log("====================================================");

	await connectDB();
	const testTimestamp = Date.now();

	// 1. Create 2 test events to test matching and wrong event detection
	const eventA = await FitflixEvent.create({
		title: `Fitflix Endurance Summit ${testTimestamp}`,
		slug: `fitflix-endurance-${testTimestamp}`,
		tagline: "Test Event A",
		eventType: EventType.MarathonRun,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "07:00 AM IST",
		venue: {
			name: "Main Arena Track",
			address: "Gate 1, Stadium Road",
			city: "Bengaluru",
		},
		totalCapacity: 50,
		ticketTiers: [
			{
				tierId: "general_pass",
				name: "General Access Pass",
				badgeLabel: "GENERAL PASS",
				badgeColor: "#10b981",
				type: "free",
				price: 0,
				totalQuantity: 30,
				soldQuantity: 5,
				perks: ["Finisher Medal", "Hydration Bag"],
			},
		],
	});

	const eventB = await FitflixEvent.create({
		title: `Fitflix Yoga Flow ${testTimestamp}`,
		slug: `fitflix-yoga-${testTimestamp}`,
		tagline: "Test Event B",
		eventType: EventType.CommunityMeetup,
		status: EventStatus.Published,
		startDate: new Date(),
		endDate: new Date(Date.now() + 86400000),
		reportingTime: "06:30 AM IST",
		venue: {
			name: "Yoga Pavilion",
			address: "Indiranagar",
			city: "Bengaluru",
		},
		totalCapacity: 20,
	});

	// 2. Create Registrations
	const reg1 = await EventRegistration.create({
		eventId: eventA._id,
		tierId: "general_pass",
		tierName: "General Access Pass",
		ticketId: `FFX-TST1-${testTimestamp}`,
		attendeeName: "Rahul Sharma",
		attendeeEmail: `rahul.${testTimestamp}@example.com`,
		attendeePhone: `98765${String(testTimestamp).slice(-5)}`,
		verificationToken: "tok_verify_test_1",
		checkedIn: false,
		paymentStatus: RegistrationPaymentStatus.Free,
	});

	const regPhone = await EventRegistration.create({
		eventId: eventA._id,
		tierId: "general_pass",
		tierName: "General Access Pass",
		ticketId: `FFX-PHON-${testTimestamp}`,
		attendeeName: "Sneha Patel",
		attendeeEmail: `sneha.${testTimestamp}@example.com`,
		attendeePhone: `91111${String(testTimestamp).slice(-5)}`,
		verificationToken: "tok_verify_test_phone",
		checkedIn: false,
		paymentStatus: RegistrationPaymentStatus.Free,
	});

	const regEventB = await EventRegistration.create({
		eventId: eventB._id,
		tierId: "yoga_pass",
		tierName: "Yoga Pass",
		ticketId: `FFX-EVTB-${testTimestamp}`,
		attendeeName: "Vikram Sen",
		attendeeEmail: `vikram.${testTimestamp}@example.com`,
		attendeePhone: `92222${String(testTimestamp).slice(-5)}`,
		verificationToken: "tok_verify_event_b",
		checkedIn: false,
		paymentStatus: RegistrationPaymentStatus.Free,
	});

	console.log(`\nCreated test Event A (${eventA.slug}) and Event B (${eventB.slug}) with 3 test registrations.\n`);

	let passedTests = 0;

	// TEST 1: Valid JSON QR payload scan
	{
		const qrPayload = JSON.stringify({
			ticketId: reg1.ticketId,
			eventId: eventA._id.toString(),
			token: reg1.verificationToken,
		});

		const { req, res, next, getResult } = createMockReqRes({
			payload: qrPayload,
			eventId: eventA._id.toString(),
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 200 && responseData.status === "VALID" && responseData.registration.checkedIn === true) {
			console.log("✅ TEST 1 PASSED: Valid JSON QR payload verified and checked in successfully.");
			passedTests++;
		} else {
			console.error("❌ TEST 1 FAILED:", statusCode, responseData);
		}
	}

	// TEST 2: Duplicate scan guard
	{
		const { req, res, next, getResult } = createMockReqRes({
			payload: reg1.ticketId,
			eventId: eventA._id.toString(),
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 409 && responseData.status === "ALREADY_CHECKED_IN") {
			console.log("✅ TEST 2 PASSED: Duplicate check-in rejected with 409 ALREADY_CHECKED_IN.");
			passedTests++;
		} else {
			console.error("❌ TEST 2 FAILED:", statusCode, responseData);
		}
	}

	// TEST 3: Attendee Phone Number lookup fallback (Broken phone / low battery fallback)
	{
		const { req, res, next, getResult } = createMockReqRes({
			payload: regPhone.attendeePhone,
			eventId: eventA._id.toString(),
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 200 && responseData.status === "VALID" && responseData.registration.attendeeName === "Sneha Patel") {
			console.log("✅ TEST 3 PASSED: Phone number fallback check-in successfully checked in Sneha Patel.");
			passedTests++;
		} else {
			console.error("❌ TEST 3 FAILED:", statusCode, responseData);
		}
	}

	// TEST 4: Wrong Event Rejection
	{
		const { req, res, next, getResult } = createMockReqRes({
			payload: regEventB.ticketId,
			eventId: eventA._id.toString(), // Scanned at Gate of Event A!
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 400 && responseData.status === "WRONG_EVENT") {
			console.log("✅ TEST 4 PASSED: Wrong event ticket correctly rejected with 400 WRONG_EVENT.");
			passedTests++;
		} else {
			console.error("❌ TEST 4 FAILED:", statusCode, responseData);
		}
	}

	// TEST 5: Non-existent / Invalid Ticket ID
	{
		const { req, res, next, getResult } = createMockReqRes({
			payload: "FFX-FAKE-TICKET-9999",
			eventId: eventA._id.toString(),
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 404 && responseData.status === "INVALID") {
			console.log("✅ TEST 5 PASSED: Fake ticket ID correctly rejected with 404 INVALID.");
			passedTests++;
		} else {
			console.error("❌ TEST 5 FAILED:", statusCode, responseData);
		}
	}

	// TEST 6: RBAC Forbidden for regular user
	{
		const { req, res, next, getResult } = createMockReqRes(
			{ payload: reg1.ticketId },
			{ id: new mongoose.Types.ObjectId().toString(), role: "user" }
		);

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 403 && responseData.code === "FORBIDDEN") {
			console.log("✅ TEST 6 PASSED: RBAC properly guards verify endpoint against non-staff.");
			passedTests++;
		} else {
			console.error("❌ TEST 6 FAILED:", statusCode, responseData);
		}
	}

	// TEST 7: Empty payload validation failure
	{
		const { req, res, next, getResult } = createMockReqRes({
			payload: "   ",
		});

		await verifyEventCheckIn(req, res, next);
		const { statusCode, responseData } = getResult();

		if (statusCode === 400 && responseData.code === "VALIDATION_ERROR") {
			console.log("✅ TEST 7 PASSED: Empty payload rejected with 400 VALIDATION_ERROR.");
			passedTests++;
		} else {
			console.error("❌ TEST 7 FAILED:", statusCode, responseData);
		}
	}

	// TEST 8: Atomic event counter verification
	{
		const updatedEventA = await FitflixEvent.findById(eventA._id);
		// Reg 1 and Reg Phone were checked in, so totalCheckedIn should be 2
		if (updatedEventA?.totalCheckedIn === 2) {
			console.log("✅ TEST 8 PASSED: Event totalCheckedIn counter updated atomically to 2.");
			passedTests++;
		} else {
			console.error("❌ TEST 8 FAILED: totalCheckedIn is", updatedEventA?.totalCheckedIn);
		}
	}

	// TEST 9 & 10: Concurrency Race Condition Test (2 simultaneous scans of the same ticket)
	{
		const raceReg = await EventRegistration.create({
			eventId: eventA._id,
			tierId: "general_pass",
			tierName: "General Access Pass",
			ticketId: `FFX-RACE-${testTimestamp}`,
			attendeeName: "Ananya Roy",
			attendeeEmail: `ananya.${testTimestamp}@example.com`,
			attendeePhone: `93333${String(testTimestamp).slice(-5)}`,
			verificationToken: "tok_verify_race",
			checkedIn: false,
			paymentStatus: RegistrationPaymentStatus.Free,
		});

		const reqRes1 = createMockReqRes({
			payload: raceReg.ticketId,
			eventId: eventA._id.toString(),
		});

		const reqRes2 = createMockReqRes({
			payload: raceReg.ticketId,
			eventId: eventA._id.toString(),
		});

		// Fire concurrently
		await Promise.all([
			verifyEventCheckIn(reqRes1.req, reqRes1.res, reqRes1.next),
			verifyEventCheckIn(reqRes2.req, reqRes2.res, reqRes2.next),
		]);

		const res1 = reqRes1.getResult();
		const res2 = reqRes2.getResult();

		const statuses = [res1.statusCode, res2.statusCode].sort();
		if (statuses[0] === 200 && statuses[1] === 409) {
			console.log("✅ TEST 9 PASSED: Concurrency race condition prevented. Exactly 1 succeeded with 200, 1 rejected with 409.");
			passedTests++;
		} else {
			console.error("❌ TEST 9 FAILED:", statuses);
		}

		const freshEventA = await FitflixEvent.findById(eventA._id);
		if (freshEventA?.totalCheckedIn === 3) {
			console.log("✅ TEST 10 PASSED: Event totalCheckedIn incremented by exactly 1 under race conditions (total = 3).");
			passedTests++;
		} else {
			console.error("❌ TEST 10 FAILED: Counter under race condition is", freshEventA?.totalCheckedIn);
		}
	}

	// Cleanup test fixtures
	await EventRegistration.deleteMany({
		_id: { $in: [reg1._id, regPhone._id, regEventB._id] },
	});
	await FitflixEvent.deleteMany({
		_id: { $in: [eventA._id, eventB._id] },
	});

	console.log("\n====================================================");
	console.log(`TEST SUMMARY: ${passedTests}/10 TESTS PASSED`);
	console.log("====================================================");

	process.exit(passedTests === 10 ? 0 : 1);
}

runCheckInVerificationTests().catch((err) => {
	console.error("Test execution failed:", err);
	process.exit(1);
});
