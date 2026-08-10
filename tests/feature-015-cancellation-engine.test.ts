import mongoose from "mongoose";
import Bookings from "../src/models/Bookings";
import ClassModel from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import { Gender, UserStatus } from "../src/models/Enums";
import User from "../src/models/User";
import { cancelBooking } from "../src/services/cancellation-engine.service";
import { registerGroupClassBooking } from "../src/services/registration-engine.service";
import {
	adminToken,
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

async function runFeature015Tests() {
	console.log("=== Feature Test: FEATURE-015 Cancellation Engine ===");
	const { baseUrl, close } = await startTestServer();

	let memberId = "";
	let memberToken = "";
	let classId = "";

	let earlySessionId = "";
	let lateSessionId = "";
	let lateSession2Id = "";

	let earlyBookingId = "";
	let lateBookingId = "";
	let overrideBookingId = "";

	try {
		console.log("\n1. Creating test User account, Class, and Scheduled Sessions...");
		const member = await User.create({
			username: "cancellation_member",
			email: "cancel.member@fitflix.test",
			phone: "+12345677099",
			gender: Gender.Male,
			age: 30,
			passwordHash: "hash123",
			firstName: "Cancel",
			lastName: "Tester",
			role: "user",
			status: UserStatus.Active,
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		memberId = member._id.toString();
		memberToken = generateTestToken("user", memberId);

		const testClass = await ClassModel.create({
			name: "Cancellation Test Class",
			creditCost: 2,
		});
		classId = testClass._id.toString();

		// Early session starting in 48 hours (> 24h prior)
		const earlySession = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 86400000 * 2),
			startTime: "10:00",
			endTime: "11:00",
			deliveryType: "OFFLINE",
			capacity: 10,
			currentBookings: 0,
			remainingCapacity: 10,
			status: "SCHEDULED",
			isPublished: true,
		});
		earlySessionId = earlySession._id.toString();

		// Late session 1 starting in 6 hours (< 24h prior)
		const lateSession = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 3600000 * 6),
			startTime: "18:00",
			endTime: "19:00",
			deliveryType: "OFFLINE",
			capacity: 10,
			currentBookings: 0,
			remainingCapacity: 10,
			status: "SCHEDULED",
			isPublished: true,
		});
		lateSessionId = lateSession._id.toString();

		// Late session 2 starting in 8 hours (< 24h prior)
		const lateSession2 = await ScheduledSession.create({
			classId,
			sessionDate: new Date(Date.now() + 3600000 * 8),
			startTime: "20:00",
			endTime: "21:00",
			deliveryType: "OFFLINE",
			capacity: 10,
			currentBookings: 0,
			remainingCapacity: 10,
			status: "SCHEDULED",
			isPublished: true,
		});
		lateSession2Id = lateSession2._id.toString();

		// Register bookings
		const regEarly = await registerGroupClassBooking({
			userId: memberId,
			sessionId: earlySessionId,
		});
		earlyBookingId = regEarly.booking.id;

		const regLate = await registerGroupClassBooking({
			userId: memberId,
			sessionId: lateSessionId,
		});
		lateBookingId = regLate.booking.id;

		const regOverride = await registerGroupClassBooking({
			userId: memberId,
			sessionId: lateSession2Id,
		});
		overrideBookingId = regOverride.booking.id;

		assert(Boolean(earlyBookingId) && Boolean(lateBookingId), "Test bookings registered");

		console.log("\n2. Testing Early Cancellation (> 24h prior)...");
		const earlyCancelRes = await fetchJson(
			baseUrl,
			`/api/v1/bookings/${earlyBookingId}/cancel`,
			{
				token: memberToken,
				method: "POST",
			},
		);
		assert(earlyCancelRes.status === 200, "POST /api/v1/bookings/:id/cancel returns 200 OK");
		assert(earlyCancelRes.data.refunded === true, "Early cancellation refunds credits");
		assert(
			earlyCancelRes.data.latePenaltyApplied === false,
			"No late penalty applied for early cancellation",
		);

		const updatedEarlySession = await ScheduledSession.findById(earlySessionId);
		assert(
			updatedEarlySession?.remainingCapacity === 10,
			"Session seat capacity released back to 10",
		);

		console.log("\n3. Testing Late Cancellation (< 24h prior - Credits Forfeited)...");
		const lateCancelRes = await fetchJson(
			baseUrl,
			`/api/v1/bookings/${lateBookingId}/cancel`,
			{
				token: memberToken,
				method: "POST",
			},
		);
		assert(lateCancelRes.status === 200, "POST /api/v1/bookings/:id/cancel returns 200 OK");
		assert(lateCancelRes.data.refunded === false, "Late cancellation forfeits credits (refunded: false)");
		assert(
			lateCancelRes.data.latePenaltyApplied === true,
			"Late penalty applied flag set to true",
		);

		console.log("\n4. Testing Admin Override Path for Late Cancellation...");
		const overrideCancelRes = await fetchJson(
			baseUrl,
			`/api/v1/bookings/${overrideBookingId}/cancel`,
			{
				token: adminToken,
				method: "POST",
				body: { adminOverride: true },
			},
		);
		assert(overrideCancelRes.status === 200, "Admin override cancellation returns 200 OK");
		assert(
			overrideCancelRes.data.refunded === true,
			"Admin override bypasses late penalty and refunds credits (refunded: true)",
		);

		console.log("\n5. Testing Repeat Cancellation Protection (400 Bad Request)...");
		const repeatCancelRes = await cancelBooking({
			bookingId: earlyBookingId,
			requesterId: memberId,
			requesterRole: "user",
		});
		assert(repeatCancelRes.success === false, "Repeat cancellation disallowed");
		assert(
			repeatCancelRes.statusCode === 400,
			"Cancelling already cancelled booking returns 400 Bad Request",
		);

		console.log("\n🎉 FEATURE-015 Cancellation Engine Tests Passed!");
	} finally {
		if (memberId) await User.findByIdAndDelete(memberId);
		if (classId) await ClassModel.findByIdAndDelete(classId);
		if (earlySessionId) await ScheduledSession.findByIdAndDelete(earlySessionId);
		if (lateSessionId) await ScheduledSession.findByIdAndDelete(lateSessionId);
		if (lateSession2Id) await ScheduledSession.findByIdAndDelete(lateSession2Id);
		const validBookingIds = [earlyBookingId, lateBookingId, overrideBookingId].filter(
			(id) => Boolean(id) && mongoose.Types.ObjectId.isValid(id),
		);
		if (validBookingIds.length > 0) {
			await Bookings.deleteMany({
				_id: { $in: validBookingIds },
			});
		}
		await close();
	}
}

runFeature015Tests().catch((err) => {
	console.error("Cancellation engine feature test failed:", err);
	process.exit(1);
});
