import mongoose from "mongoose";
import OperationalAlert from "../src/models/OperationalAlert";
import Location from "../src/models/Location";
import UnifiedBooking from "../src/models/UnifiedBooking";
import ExpertSchedule from "../src/models/ExpertSchedule";
import User from "../src/models/User";
import Trainer from "../src/models/Trainer";
import {
	AlertSeverity,
	AlertStatus,
	AlertType,
	AppointmentMode,
	ExpertType,
	MeetingStatus,
	UnifiedBookingStatus,
} from "../src/models/Enums";
import { markUnifiedBookingNoShow } from "../src/services/unified-booking.service";
import { checkTrainerNoShowSessions } from "../src/services/session-room-lifecycle.service";
import { updateExpertSchedule } from "../src/services/expert-schedule.service";
import { autoResolveOperationalAlerts } from "../src/controllers/operational-alert.controller";
import { assert } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Operational Alerts & Escalation (FX-41) Tests...");

	const mongoUri =
		process.env.MONGODB_URL ||
		process.env.MONGODB_URI ||
		"mongodb://127.0.0.1:27017/hybridhuman";

	if (mongoose.connection.readyState === 0) {
		await mongoose.connect(mongoUri);
	}

	// 1. Setup mock branch
	let branch = await Location.findOne({ code: "ALERT_TEST_BRANCH" });
	if (!branch) {
		branch = await Location.create({
			name: "Alert Test Branch",
			code: "ALERT_TEST_BRANCH",
			timezone: "Asia/Kolkata",
			isActive: true,
		});
	}
	const branchId = branch._id;

	// Mock user and trainer
	const testUser = await User.create({
		username: `alert_member_${Date.now()}`,
		email: `alert_member_${Date.now()}@example.com`,
		phone: "+919876543210",
		age: 26,
		gender: "Male",
		onboarded: true,
	});

	const testTrainer = await Trainer.create({
		trainerName: `Trainer_${Date.now()}`,
		email: `trainer_${Date.now()}@fitflix.com`,
		phone: "+919876543211",
		passwordHash: "$2a$10$abcdefghijklmnopqrstuvwxyz123456",
		isActive: true,
	});

	// ─── Test FX-41.1: Trainer records member no-show ──────────────────────
	console.log("\n🔎 FX-41.1: Alert fires when a trainer records a member no-show");
	const booking1 = await UnifiedBooking.create({
		userId: testUser._id,
		expertId: testTrainer._id,
		expertModel: "Trainer",
		assignedExpertName: testTrainer.trainerName,
		bookingDate: new Date(),
		startTime: "09:00",
		endTime: "09:45",
		appointmentMode: AppointmentMode.IN_PERSON,
		locationId: branchId,
		status: UnifiedBookingStatus.CONFIRMED,
		meetingStatus: MeetingStatus.SCHEDULED,
	});

	const noShowResult = await markUnifiedBookingNoShow(
		String(booking1._id),
		"Member did not turn up",
		String(testTrainer._id),
	);

	assert(noShowResult.booking.status === UnifiedBookingStatus.MEMBER_NO_SHOW, "Booking status changed to MEMBER_NO_SHOW");

	const alert1 = await OperationalAlert.findOne({
		"relatedEntity.entityType": "booking",
		"relatedEntity.entityId": String(booking1._id),
		type: AlertType.MemberNoShow,
	});
	assert(alert1 != null, "OperationalAlert of type MemberNoShow was created");
	assert(alert1?.status === AlertStatus.Open, "Alert status is Open");
	assert(alert1?.title.includes("Member No-Show"), "Alert title indicates member no-show");

	// ─── Test FX-41.4: Alert links straight to booking with metadata ───────
	console.log("\n🔎 FX-41.4: Alert links straight to booking with call & rebook metadata");
	assert(alert1?.relatedEntity.entityId === String(booking1._id), "Alert links directly to booking ID");
	const meta = (alert1?.relatedEntity as any).metadata;
	assert(meta != null, "Alert carries metadata payload");
	assert(meta.memberPhone === "+919876543210", "Alert metadata contains member phone for 1-click calling");
	assert(meta.deepLinkUrl.includes(String(booking1._id)), "Alert metadata contains deep link for 1-click rebooking");

	// ─── Test FX-41.5: Alert resolves on its own once rebooked, cancelled, or attended ──
	console.log("\n🔎 FX-41.5: Alert resolves on its own upon autoResolveOperationalAlerts");
	const resolvedCount = await autoResolveOperationalAlerts(
		"booking",
		String(booking1._id),
		"Booking rebooked by front desk staff",
	);
	assert(resolvedCount >= 1, "autoResolveOperationalAlerts resolved at least 1 alert");

	const alert1After = await OperationalAlert.findById(alert1?._id);
	assert(alert1After?.status === AlertStatus.Resolved, "Alert transitioned to Resolved status");
	assert(alert1After?.resolutionReason?.includes("rebooked"), "Alert logged resolution reason");

	// ─── Test FX-41.2: In-person session start time + grace period ─────────
	console.log("\n🔎 FX-41.2: Alert fires when trainer hasn't started in-person session by start + grace");
	// Create an in-person session whose start time was 10 minutes ago
	const pastDate = new Date();
	const pastHours = String(pastDate.getHours()).padStart(2, "0");
	const pastMinutes = String(Math.max(0, pastDate.getMinutes() - 10)).padStart(2, "0");
	const pastStartTime = `${pastHours}:${pastMinutes}`;

	const booking2 = await UnifiedBooking.create({
		userId: testUser._id,
		expertId: testTrainer._id,
		expertModel: "Trainer",
		assignedExpertName: testTrainer.trainerName,
		bookingDate: pastDate,
		startTime: pastStartTime,
		endTime: `${pastHours}:55`,
		appointmentMode: AppointmentMode.IN_PERSON,
		locationId: branchId,
		status: UnifiedBookingStatus.CONFIRMED,
		meetingStatus: MeetingStatus.SCHEDULED,
	});

	const { alerted } = await checkTrainerNoShowSessions();
	assert(alerted >= 1, "checkTrainerNoShowSessions detected unstarted in-person session and fired alert");

	const alert2 = await OperationalAlert.findOne({
		"relatedEntity.entityType": "booking",
		"relatedEntity.entityId": String(booking2._id),
		type: AlertType.TrainerMissing,
	});
	assert(alert2 != null, "OperationalAlert for missing trainer on in-person session was created");
	assert(alert2?.message.includes("In-person"), "Alert message specifies in-person session");

	// ─── Test FX-41.3: Expert becomes unavailable for a booked slot ────────
	console.log("\n🔎 FX-41.3: Alert fires when expert becomes unavailable for a booked slot");
	const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
	const futureDateStr = futureDate.toISOString().slice(0, 10);

	const booking3 = await UnifiedBooking.create({
		userId: testUser._id,
		expertId: testTrainer._id,
		expertModel: "Trainer",
		assignedExpertName: testTrainer.trainerName,
		bookingDate: futureDate,
		startTime: "14:00",
		endTime: "14:45",
		appointmentMode: AppointmentMode.IN_PERSON,
		locationId: branchId,
		status: UnifiedBookingStatus.CONFIRMED,
		meetingStatus: MeetingStatus.SCHEDULED,
	});

	// Trainer updates schedule: marks tomorrow as a blackout date!
	await updateExpertSchedule(
		String(testTrainer._id),
		{
			blackoutDates: [new Date(`${futureDateStr}T00:00:00.000Z`)],
		},
		ExpertType.Trainer,
	);

	const booking3After = await UnifiedBooking.findById(booking3._id);
	assert(booking3After?.status === UnifiedBookingStatus.RESCHEDULE_REQUIRED, "Conflicted booking marked RESCHEDULE_REQUIRED");

	const alert3 = await OperationalAlert.findOne({
		"relatedEntity.entityType": "booking",
		"relatedEntity.entityId": String(booking3._id),
		type: AlertType.ExpertUnavailable,
	});
	assert(alert3 != null, "OperationalAlert of type ExpertUnavailable was fired");
	assert(alert3?.severity === AlertSeverity.Critical, "ExpertUnavailable alert has Critical severity");
	assert(alert3?.title.includes("Expert Unavailable"), "Alert title indicates expert unavailability");

	// Clean up test entities
	await OperationalAlert.deleteMany({ _id: { $in: [alert1?._id, alert2?._id, alert3?._id].filter(Boolean) } });
	await UnifiedBooking.deleteMany({ _id: { $in: [booking1._id, booking2._id, booking3._id] } });
	await User.deleteOne({ _id: testUser._id });
	await Trainer.deleteOne({ _id: testTrainer._id });

	console.log("\n✅ All FX-41 Acceptance Criteria tests PASSED successfully!\n");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("❌ Test failed:", err);
	process.exit(1);
});
