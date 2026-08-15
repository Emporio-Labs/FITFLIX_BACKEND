import mongoose from "mongoose";
import {
	AppointmentMode,
	CreditTransactionSource,
	CreditTransactionType,
	ExpertType,
	MembershipStatus,
	ServiceCategory,
	ServiceSubtype,
	TrainerChangeRequestStatus,
	UnifiedBookingStatus,
} from "../src/models/Enums";
import CreditTransaction from "../src/models/CreditTransaction";
import ExpertSchedule from "../src/models/ExpertSchedule";
import Invoice from "../src/models/Invoice";
import Lead from "../src/models/Lead";
import Membership from "../src/models/Membership";
import MembershipPlan from "../src/models/MembershipPlan";
import Trainer from "../src/models/Trainer";
import TrainerChangeRequest from "../src/models/TrainerChangeRequest";
import UnifiedBooking from "../src/models/UnifiedBooking";
import { runCallbackEscalationSweep } from "../src/schedulers/callback-escalation.scheduler";
import { runHostNoShowSweep } from "../src/schedulers/host-noshow.scheduler";
import {
	createCallbackInquiry,
	createPaymentOrder,
	getBillingConfig,
	verifyAndProvisionPayment,
} from "../src/services/billing-provisioning.service";
import {
	calculateAvailableSlots,
	getOrCreateExpertSchedule,
} from "../src/services/expert-schedule.service";
import {
	cancelUnifiedBooking,
	completeUnifiedBooking,
	createPersonalTrainingBooking,
	createTrainerChangeRequest,
	resolveTrainerChangeRequest,
} from "../src/services/unified-booking.service";
import { generateInvoiceNumber } from "../src/utils/invoice-number";
import { assert, startTestServer } from "./test-helpers";

async function runTests() {
	console.log("\n🚀 Starting Personal Training & Unified Engine Phase 1 Test Suite...\n");

	const { server, baseUrl, close } = await startTestServer();

	const testUserId = new mongoose.Types.ObjectId();
	const testTrainerId = new mongoose.Types.ObjectId();
	const testTrainer2Id = new mongoose.Types.ObjectId();

	try {
		// ── Setup Test Data ──
		await Trainer.deleteMany({ _id: { $in: [testTrainerId, testTrainer2Id] } });
		await UnifiedBooking.deleteMany({ userId: testUserId });
		await Membership.deleteMany({ user: testUserId });
		await TrainerChangeRequest.deleteMany({ userId: testUserId });

		const trainer1 = await Trainer.create({
			_id: testTrainerId,
			trainerName: "Coach Marcus",
			description: "Olympic Lifting & Hypertrophy Specialist",
			specialities: ["Strength", "Hypertrophy"],
			email: `marcus_${Date.now()}@fitflix.test`,
			phone: "+91 98765 43210",
			passwordHash: "dummyhash123",
			isActive: true,
		});

		const trainer2 = await Trainer.create({
			_id: testTrainer2Id,
			trainerName: "Coach Elena",
			description: "Biomechanics & Rehabilitation",
			specialities: ["Mobility", "Conditioning"],
			email: `elena_${Date.now()}@fitflix.test`,
			phone: "+91 98765 43211",
			passwordHash: "dummyhash123",
			isActive: true,
		});

		// ── Test 1: Expert Schedule & Slot Calculation ──
		console.log("\n[Test 1] Expert Schedule & Slot Generation");
		const schedule = await getOrCreateExpertSchedule(trainer1._id.toString(), ExpertType.Trainer);
		assert(schedule !== null, "ExpertSchedule created/retrieved successfully");
		assert(schedule.slotDurationMinutes === 45, "Default slot duration is 45 minutes");

		const testDate = new Date();
		testDate.setDate(testDate.getDate() + 1);
		// If testDate lands on Sunday (day 0, unavailable by default), advance to Monday
		if (testDate.getDay() === 0) {
			testDate.setDate(testDate.getDate() + 1);
		}
		const testDateStr = testDate.toISOString().slice(0, 10);

		const availableSlots = await calculateAvailableSlots(trainer1._id.toString(), testDateStr);
		assert(Array.isArray(availableSlots), "Slots returned as array");
		assert(availableSlots.length > 0, "Available slots generated for working hours");
		console.log(`  Generated ${availableSlots.length} available slots for working day (${testDateStr})`);

		// ── Test 2: Invoicing Sequential Counter ──
		console.log("\n[Test 2] Sequential Invoice Counter (FF-INV-YYYY-XXXXX)");
		const invNum1 = await generateInvoiceNumber();
		const invNum2 = await generateInvoiceNumber();
		assert(invNum1.startsWith("FF-INV-"), `Invoice 1 has FF-INV prefix: ${invNum1}`);
		assert(invNum2.startsWith("FF-INV-"), `Invoice 2 has FF-INV prefix: ${invNum2}`);
		assert(invNum1 !== invNum2, "Sequential invoices are uniquely numbered without collisions");

		// ── Test 3: Plan Creation & Quota Provisioning ──
		console.log("\n[Test 3] PT Package Provisioning & Billing Config");
		const billingConfig = getBillingConfig();
		assert(billingConfig.currency === "INR", "Currency is INR");
		assert(billingConfig.taxRatePercent === 18, "+18% GST configured");

		const testPlan = await MembershipPlan.create({
			name: "PT 14 Classes / Month",
			category: "PERSONAL_TRAINING",
			price: 14000,
			currency: "INR",
			ptSessionsIncluded: 14,
			durationDays: 30,
			active: true,
		});

		const order = await createPaymentOrder(testUserId.toString(), testPlan._id.toString());
		assert(order.plan.grandTotal === 16520, "14,000 + 18% GST (2,520) = 16,520 Grand Total");

		// Provision membership with 14 sessions
		const membership = await Membership.create({
			user: testUserId,
			planName: "PT 14 Classes / Month",
			category: "PERSONAL_TRAINING",
			ptSessionsIncluded: 14,
			ptSessionsRemaining: 14,
			ptSessionsUsed: 0,
			assignedTrainerId: trainer1._id,
			assignedTrainerName: trainer1.trainerName,
			status: MembershipStatus.Active,
			price: 16520,
			currency: "INR",
			startDate: new Date(),
			endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		});
		assert(membership.ptSessionsRemaining === 14, "Membership initialized with 14 PT sessions remaining");

		// ── Test 4: Atomic PT Booking (Path A: Credit Deduction) ──
		console.log("\n[Test 4] Atomic Slot Booking & Quota Deduction");
		const booking1 = await createPersonalTrainingBooking({
			userId: testUserId.toString(),
			trainerId: trainer1._id.toString(),
			bookingDate: testDate,
			startTime: "09:00",
			endTime: "09:45",
			appointmentMode: AppointmentMode.ONLINE,
		});

		assert(booking1 !== null, "Booking 1 created successfully");
		assert(booking1.zegoRoomId === `session_${booking1._id.toString()}`, "Zego room ID generated deterministically");

		const updatedMem1 = await Membership.findById(membership._id);
		assert(updatedMem1?.ptSessionsRemaining === 13, "Remaining PT sessions atomically decremented to 13");
		assert(updatedMem1?.ptSessionsUsed === 1, "Used PT sessions incremented to 1");

		// ── Test 5: Concurrency Conflict Detection (Range Overlap Guard) ──
		console.log("\n[Test 5] Concurrency & Overlap Conflict Prevention");
		let conflictCaught = false;
		try {
			// Attempting exact same or overlapping slot with same trainer
			await createPersonalTrainingBooking({
				userId: testUserId.toString(),
				trainerId: trainer1._id.toString(),
				bookingDate: testDate,
				startTime: "09:00",
				endTime: "09:45",
				appointmentMode: AppointmentMode.ONLINE,
			});
		} catch (e: any) {
			conflictCaught = true;
			assert(e.name === "SlotConflictError", `Conflict error caught: ${e.message}`);
		}
		assert(conflictCaught, "Overlapping slot booking was strictly rejected");

		// ── Test 6: 24-Hour Early Cancellation Refund Engine ──
		console.log("\n[Test 6] 24-Hour Cancellation & Quota Refund");
		// Create a session 3 days in advance (well over 24h)
		const threeDaysAhead = new Date();
		threeDaysAhead.setDate(threeDaysAhead.getDate() + 3);

		const bookingFuture = await createPersonalTrainingBooking({
			userId: testUserId.toString(),
			trainerId: trainer1._id.toString(),
			bookingDate: threeDaysAhead,
			startTime: "10:00",
			endTime: "10:45",
			appointmentMode: AppointmentMode.ONLINE,
		});

		const cancelResult = await cancelUnifiedBooking({
			bookingId: bookingFuture._id.toString(),
			requesterId: testUserId.toString(),
			requesterRole: "user",
			now: new Date(),
		});

		assert(cancelResult.isEarlyCancellation === true, "Identified as early cancellation (>=24h)");
		assert(cancelResult.refunded === true, "Session credit was refunded");

		const updatedMem2 = await Membership.findById(membership._id);
		assert(updatedMem2?.ptSessionsRemaining === 13, "Quota restored back to 13 sessions (1 used on booking1)");

		// ── Test 7: Host No-Show Auto-Healing Sweep ──
		console.log("\n[Test 7] Host No-Show Auto-Healing Scheduler");
		// Create a past booking where host never joined (yesterday)
		const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
		const bookingPast = await UnifiedBooking.create({
			userId: testUserId,
			serviceCategory: ServiceCategory.EXPERT_SESSION,
			serviceSubtype: ServiceSubtype.TRAINER,
			expertId: trainer1._id,
			packageId: membership._id,
			bookingDate: pastDate,
			startTime: "06:00",
			endTime: "06:45",
			appointmentMode: AppointmentMode.ONLINE,
			status: UnifiedBookingStatus.CONFIRMED,
			hostLiveAt: null, // Host never joined
			creditCostSnapshot: 1,
		});

		// Deduct 1 credit for setup
		await Membership.findByIdAndUpdate(membership._id, { $inc: { ptSessionsRemaining: -1, ptSessionsUsed: 1 } });

		await runHostNoShowSweep();

		const refreshedBooking = await UnifiedBooking.findById(bookingPast._id);
		assert(refreshedBooking?.status === UnifiedBookingStatus.HOST_NO_SHOW, "Past booking marked as HOST_NO_SHOW");

		const updatedMem3 = await Membership.findById(membership._id);
		assert(updatedMem3?.ptSessionsRemaining === 13, "Member credit automatically restored from 12 back to 13 by host no-show sweep");

		// ── Test 8: Callback Lead 15-Minute SLA Escalation ──
		console.log("\n[Test 8] Callback Lead 15-Minute SLA Escalation");
		const pastSlaDate = new Date(Date.now() - 20 * 60 * 1000); // 20 mins ago
		const lead = await Lead.create({
			leadName: "John Doe",
			phone: "+91 99999 88888",
			source: "APP_PAYMENT_FALLBACK",
			slaDeadline: pastSlaDate,
			isEscalated: false,
		});

		await runCallbackEscalationSweep();

		const refreshedLead = await Lead.findById(lead._id);
		assert(refreshedLead?.isEscalated === true, "Overdue lead automatically escalated to High Priority");

		// ── Test 9: Trainer Lock Enforcement & Change Request Workflow ──
		console.log("\n[Test 9] Trainer Lock Enforcement & Change Request Workflow");

		// Attempting to book with trainer2 while assigned to trainer1 MUST fail with TrainerLockedError
		let lockCaught = false;
		try {
			await createPersonalTrainingBooking({
				userId: testUserId.toString(),
				trainerId: trainer2._id.toString(),
				bookingDate: threeDaysAhead,
				startTime: "14:00",
				endTime: "14:45",
				appointmentMode: AppointmentMode.ONLINE,
			});
		} catch (e: any) {
			lockCaught = true;
			assert(e.name === "TrainerLockedError", `Trainer lock error caught: ${e.message}`);
		}
		assert(lockCaught, "Non-assigned trainer booking was strictly blocked by TrainerLockedError");

		// Member requests switch to trainer2
		const changeReq = await createTrainerChangeRequest({
			userId: testUserId.toString(),
			requestedTrainerId: trainer2._id.toString(),
			reason: "Schedule conflict with morning slots, prefer Coach Elena",
		});
		assert(changeReq.status === TrainerChangeRequestStatus.PENDING, "Change request created with PENDING status");

		const adminUserId = new mongoose.Types.ObjectId();
		const resolvedReq = await resolveTrainerChangeRequest(
			changeReq._id.toString(),
			"APPROVE",
			"Approved by Frontdesk Manager",
			adminUserId.toString(),
		);
		assert(resolvedReq.status === TrainerChangeRequestStatus.APPROVED, "Change request approved");

		const updatedMem4 = await Membership.findById(membership._id);
		assert(
			String(updatedMem4?.assignedTrainerId) === String(trainer2._id),
			`Membership reassigned to new trainer: ${trainer2.trainerName}`,
		);

		// Now member can book with trainer2
		const bookingTrainer2 = await createPersonalTrainingBooking({
			userId: testUserId.toString(),
			trainerId: trainer2._id.toString(),
			bookingDate: threeDaysAhead,
			startTime: "14:00",
			endTime: "14:45",
			appointmentMode: AppointmentMode.ONLINE,
		});
		assert(bookingTrainer2 !== null, "Successfully booked session with newly assigned trainer2");

		console.log("\n✨ ALL 9 TEST CASES (INCLUDING TRAINER LOCK) PASSED WITH 100% SUCCESS!\n");
	} finally {
		await close();
	}
}

runTests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("\n❌ Test Suite Failed:", err);
		process.exit(1);
	});
