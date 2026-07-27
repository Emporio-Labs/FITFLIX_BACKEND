import ClassModel from "../src/models/Class";
import User from "../src/models/User";
import { evaluateBookingRules } from "../src/services/booking-rules-engine.service";
import { assert, startTestServer } from "./test-helpers";

async function runFeature012Tests() {
	console.log("=== Feature Test: FEATURE-012 Booking Rules Engine ===");
	const { close } = await startTestServer();

	let activeUserId = "";
	let inactiveUserId = "";
	let expiredUserId = "";
	let class72hId = "";
	let class48hId = "";

	try {
		console.log("\n1. Creating test User accounts & configured Class records...");
		const activeUser = await User.create({
			username: "active_member_test",
			email: "active.member@fitflix.test",
			phone: "+12345678901",
			gender: "Male",
			age: 28,
			passwordHash: "hash123",
			firstName: "Active",
			lastName: "Member",
			role: "user",
			status: "ACTIVE",
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		activeUserId = activeUser._id.toString();

		const inactiveUser = await User.create({
			username: "inactive_member_test",
			email: "inactive.member@fitflix.test",
			phone: "+12345678902",
			gender: "Female",
			age: 30,
			passwordHash: "hash123",
			firstName: "Inactive",
			lastName: "Member",
			role: "user",
			status: "SUSPENDED",
			isActive: false,
		});
		inactiveUserId = inactiveUser._id.toString();

		const expiredUser = await User.create({
			username: "expired_member_test",
			email: "expired.member@fitflix.test",
			phone: "+12345678903",
			gender: "Other",
			age: 35,
			passwordHash: "hash123",
			firstName: "Expired",
			lastName: "Member",
			role: "user",
			status: "ACTIVE",
			membershipStatus: "EXPIRED",
		});
		expiredUserId = expiredUser._id.toString();

		// Class with 72h default window
		const class72h = await ClassModel.create({
			name: "Standard 72h Class",
			creditCost: 3,
			bookingWindowValue: 72,
			bookingWindowUnit: "hours",
		});
		class72hId = class72h._id.toString();

		// Class with 2 days (48h) custom admin window
		const class48h = await ClassModel.create({
			name: "Custom 2 Days Admin Class",
			creditCost: 5,
			bookingWindowValue: 2,
			bookingWindowUnit: "days",
		});
		class48hId = class48h._id.toString();

		assert(Boolean(activeUserId) && Boolean(class72hId), "Base test records created");

		console.log("\n2. Testing Inactive Account Guard (403 Forbidden)...");
		const inactiveResult = await evaluateBookingRules({
			userId: inactiveUserId,
			classId: class72hId,
			sessionDate: new Date(Date.now() + 86400000 * 2),
			startTime: "10:00",
		});
		assert(inactiveResult.allowed === false, "Inactive account booking disallowed");
		assert(inactiveResult.statusCode === 403, "Returns 403 Forbidden for inactive account");
		assert(
			inactiveResult.message === "Member account is inactive or suspended",
			"Expected inactive account message returned",
		);

		console.log("\n3. Testing Expired Membership Tier Guard (403 Forbidden)...");
		const expiredResult = await evaluateBookingRules({
			userId: expiredUserId,
			classId: class72hId,
			sessionDate: new Date(Date.now() + 86400000 * 2),
			startTime: "10:00",
		});
		assert(expiredResult.allowed === false, "Expired membership booking disallowed");
		assert(expiredResult.statusCode === 403, "Returns 403 Forbidden for expired membership");

		console.log("\n4. Testing Early Booking Window Guard (> WindowHours Prior)...");
		// 96 hours in advance (too early for 72h window)
		const earlyDate = new Date(Date.now() + 86400000 * 4);
		const earlyResult = await evaluateBookingRules({
			userId: activeUserId,
			classId: class72hId,
			sessionDate: earlyDate,
			startTime: "10:00",
			now: new Date(),
		});
		assert(earlyResult.allowed === false, "Attempting booking earlier than 72h window disallowed");
		assert(earlyResult.statusCode === 403, "Returns 403 Forbidden for early booking attempt");
		assert(
			earlyResult.message?.includes("Booking window opens 72 hours"),
			"Message indicates dynamic 72 hours window",
		);

		console.log("\n5. Testing Custom Admin Configured Window (2 Days / 48h)...");
		// 60 hours in advance (too early for 48h window, but allowed under 72h)
		const customEarlyResult = await evaluateBookingRules({
			userId: activeUserId,
			classId: class48hId,
			sessionDate: new Date(Date.now() + 86400000 * 2.5),
			startTime: "10:00",
			now: new Date(),
		});
		assert(
			customEarlyResult.allowed === false,
			"Respects custom admin configured 2 days window",
		);
		assert(
			customEarlyResult.message?.includes("Booking window opens 2 days"),
			"Message reflects admin configured unit and value (2 days)",
		);

		console.log("\n6. Testing Post-Start Closed Window Guard...");
		const pastSessionDate = new Date(Date.now() - 86400000);
		const pastResult = await evaluateBookingRules({
			userId: activeUserId,
			classId: class72hId,
			sessionDate: pastSessionDate,
			startTime: "09:00",
			now: new Date(),
		});
		assert(pastResult.allowed === false, "Attempting booking after session start disallowed");
		assert(pastResult.statusCode === 403, "Returns 403 Forbidden for closed session window");
		assert(
			pastResult.message === "Booking window closed as class has already started",
			"Expected closed session message returned",
		);

		console.log("\n7. Testing Valid Active Member Booking Execution...");
		// 24 hours in advance (well within 72h window)
		const validResult = await evaluateBookingRules({
			userId: activeUserId,
			classId: class72hId,
			sessionDate: new Date(Date.now() + 86400000),
			startTime: "10:00",
			now: new Date(),
		});
		assert(validResult.allowed === true, "Valid active member booking evaluated successfully (allowed: true)");

		console.log("\n🎉 FEATURE-012 Booking Rules Engine Tests Passed!");
	} finally {
		if (activeUserId) await User.findByIdAndDelete(activeUserId);
		if (inactiveUserId) await User.findByIdAndDelete(inactiveUserId);
		if (expiredUserId) await User.findByIdAndDelete(expiredUserId);
		if (class72hId) await ClassModel.findByIdAndDelete(class72hId);
		if (class48hId) await ClassModel.findByIdAndDelete(class48hId);
		await close();
	}
}

runFeature012Tests().catch((err) => {
	console.error("Booking rules engine feature test failed:", err);
	process.exit(1);
});
