import mongoose from "mongoose";
import Bookings from "../src/models/Bookings";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import User from "../src/models/User";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

async function runFeature014Tests() {
	console.log("=== Feature Test: FEATURE-014 Registration Engine ===");
	const { baseUrl, close } = await startTestServer();

	let member1Id = "";
	let member2Id = "";
	let member1Token = "";
	let member2Token = "";

	let classId = "";
	let validSessionId = "";
	let fullSessionId = "";
	let earlySessionId = "";

	try {
		console.log("\n1. Creating test User accounts, Class, and Scheduled Sessions...");
		const m1 = await User.create({
			username: "registration_m1",
			email: "reg.m1@fitflix.test",
			phone: "+12345677001",
			gender: "Male",
			age: 27,
			passwordHash: "hash123",
			firstName: "Reg",
			lastName: "One",
			role: "user",
			status: "ACTIVE",
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		member1Id = m1._id.toString();
		member1Token = generateTestToken("user", member1Id);

		const m2 = await User.create({
			username: "registration_m2",
			email: "reg.m2@fitflix.test",
			phone: "+12345677002",
			gender: "Female",
			age: 29,
			passwordHash: "hash123",
			firstName: "Reg",
			lastName: "Two",
			role: "user",
			status: "ACTIVE",
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		member2Id = m2._id.toString();
		member2Token = generateTestToken("user", member2Id);

		const testClass = await ClassModel.create({
			name: "Registration Engine Test Class",
			creditCost: 3,
			bookingWindowValue: 72,
			bookingWindowUnit: "hours",
		});
		classId = testClass._id.toString();

		// Session starting in 24 hours (within 72h window, capacity 10)
		const validSession = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 86400000),
			startTime: "10:00",
			endTime: "11:00",
			deliveryType: "OFFLINE",
			capacity: 10,
			currentBookings: 0,
			remainingCapacity: 10,
			status: "SCHEDULED",
			isPublished: true,
		});
		validSessionId = validSession._id.toString();

		// Session with capacity 1
		const fullSession = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 86400000),
			startTime: "11:30",
			endTime: "12:30",
			deliveryType: "OFFLINE",
			capacity: 1,
			currentBookings: 0,
			remainingCapacity: 1,
			status: "SCHEDULED",
			isPublished: true,
		});
		fullSessionId = fullSession._id.toString();

		// Session starting in 120 hours (too early for 72h window)
		const earlySession = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 86400000 * 5),
			startTime: "14:00",
			endTime: "15:00",
			deliveryType: "OFFLINE",
			capacity: 10,
			currentBookings: 0,
			remainingCapacity: 10,
			status: "SCHEDULED",
			isPublished: true,
		});
		earlySessionId = earlySession._id.toString();

		assert(Boolean(member1Id) && Boolean(validSessionId), "Base test records created");

		console.log("\n2. Testing Successful Registration (POST /api/v1/bookings)...");
		const regRes = await fetchJson(baseUrl, "/api/v1/bookings", {
			token: member1Token,
			method: "POST",
			body: { sessionId: validSessionId },
		});
		assert(regRes.status === 201, "POST /api/v1/bookings returns 201 Created");
		assert(regRes.data.booking.status === "Confirmed", "Booking status is 'Confirmed'");
		assert(
			regRes.data.remainingCapacity === 9,
			"Session remaining capacity decremented to 9",
		);

		console.log("\n3. Testing Duplicate Booking Prevention Guard (409 Conflict)...");
		const duplicateRes = await fetchJson(baseUrl, "/api/v1/bookings", {
			token: member1Token,
			method: "POST",
			body: { sessionId: validSessionId },
		});
		assert(duplicateRes.status === 409, "Duplicate registration attempt returns 409 Conflict");
		const dupMsg = duplicateRes.data.message || duplicateRes.data.error;
		assert(
			dupMsg === "Member is already registered for this class session",
			"Expected duplicate registration conflict message returned",
		);

		console.log("\n4. Testing Booking Window Guard (403 Forbidden)...");
		const windowRes = await fetchJson(baseUrl, "/api/v1/bookings", {
			token: member1Token,
			method: "POST",
			body: { sessionId: earlySessionId },
		});
		assert(windowRes.status === 403, "Early booking window attempt returns 403 Forbidden");

		console.log("\n5. Testing Session Capacity Full Guard (409 Conflict)...");
		// Member 1 books the only seat in fullSession (capacity 1)
		const firstSeatRes = await fetchJson(baseUrl, "/api/v1/bookings", {
			token: member1Token,
			method: "POST",
			body: { sessionId: fullSessionId },
		});
		assert(firstSeatRes.status === 201, "Member 1 booked sole available seat");

		// Member 2 attempts booking fullSession ➔ expect 409 Conflict
		const fullRes = await fetchJson(baseUrl, "/api/v1/bookings", {
			token: member2Token,
			method: "POST",
			body: { sessionId: fullSessionId },
		});
		assert(fullRes.status === 409, "Booking full session returns 409 Conflict");
		const fullMsg = fullRes.data.message || fullRes.data.error;
		assert(
			fullMsg === "Session capacity is full",
			"Expected capacity full message returned",
		);

		console.log("\n🎉 FEATURE-014 Registration Engine Tests Passed!");
	} finally {
		if (member1Id) await User.findByIdAndDelete(member1Id);
		if (member2Id) await User.findByIdAndDelete(member2Id);
		if (classId) await ClassModel.findByIdAndDelete(classId);
		if (validSessionId) await ScheduledSession.findByIdAndDelete(validSessionId);
		if (fullSessionId) await ScheduledSession.findByIdAndDelete(fullSessionId);
		if (earlySessionId) await ScheduledSession.findByIdAndDelete(earlySessionId);
		await Bookings.deleteMany({
			sessionId: { $in: [validSessionId, fullSessionId, earlySessionId] },
		});
		await close();
	}
}

runFeature014Tests().catch((err) => {
	console.error("Registration engine feature test failed:", err);
	process.exit(1);
});
