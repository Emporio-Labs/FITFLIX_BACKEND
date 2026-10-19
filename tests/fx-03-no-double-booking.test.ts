import mongoose from "mongoose";
import {
	AppointmentMode,
	CreditTransactionSource,
	CreditTransactionType,
	MembershipStatus,
	UnifiedBookingStatus,
} from "../src/models/Enums";
import Bookings from "../src/models/Bookings";
import ClassModel from "../src/models/Class";
import CreditTransaction from "../src/models/CreditTransaction";
import Membership from "../src/models/Membership";
import ScheduledSession from "../src/models/ScheduledSession";
import Trainer from "../src/models/Trainer";
import UnifiedBooking from "../src/models/UnifiedBooking";
import User from "../src/models/User";
import { registerGroupClassBooking } from "../src/services/registration-engine.service";
import {
	createPersonalTrainingBooking,
	SlotConflictError,
} from "../src/services/unified-booking.service";
import { assert, startTestServer } from "./test-helpers";

/**
 * FX-03 — No double bookings when many book at once (story US-QA-04, work-plan N8).
 *
 * Fires 50 truly-simultaneous bookings (Promise.all, one Node process) at a
 * single 10-seat class session and at a single personal-training slot, and
 * proves the data layer never overbooks and never mis-charges credits:
 *
 *   FX-03.1  50 → one 10-seat class  = exactly 10 confirmed, 40 "class full".
 *   FX-03.2  50 → one PT slot        = exactly 1 confirmed.
 *   FX-03.3  every confirmed booking takes credits once; every refused one none.
 *
 * It calls the booking SERVICES directly rather than over HTTP, so it stresses
 * the database-level guard (atomic capacity update for classes, the partial
 * unique index for PT) without the api rate-limiter rejecting the burst. Wider
 * multi-process load is FX-26.
 *
 * MUST run against a replica set (a copy of production). The PT credit-rollback
 * guarantee for refused bookings relies on a real MongoDB transaction, which
 * only exists on a replica set — see docs/qa/FX-03-no-double-booking.md.
 */

const CONCURRENCY = 50;
const CLASS_CAPACITY = 10;
const RUN = Date.now().toString(36);
const EMAIL_DOMAIN = "fx03.test";
const classMemberIds: mongoose.Types.ObjectId[] = [];
const ptMemberIds: mongoose.Types.ObjectId[] = [];
let classId = "";
let sessionId = "";
let trainerId: mongoose.Types.ObjectId | null = null;

function requireReplicaSet() {
	const topology =
		(mongoose.connection as any).client?.topology?.description?.type ??
		"Unknown";
	console.log(`  MongoDB topology: ${topology}`);
	const isReplicaSet =
		topology === "ReplicaSetWithPrimary" || topology === "Sharded";
	assert(
		isReplicaSet,
		`Connected to a replica set (got "${topology}"). FX-03 requires a copy-of-production ` +
			"replica set so transactions (and the credit-rollback guarantee) are real. " +
			"See docs/qa/FX-03-no-double-booking.md to start one.",
	);
}

async function seedMember(kind: "class" | "pt", i: number) {
	// `new ... .save()` rather than `Model.create({...})` to sidestep a mongoose
	// single-object overload that infers `never` for `_id` under strict TS.
	const user = new User({
		username: `FX03 ${kind} ${i}`,
		phone: `8${RUN.slice(-5)}${String(i).padStart(4, "0")}`.slice(0, 12),
		email: `fx03-${kind}-${i}-${RUN}@${EMAIL_DOMAIN}`,
		age: 30,
		gender: "Other",
		isActive: true,
		passwordHash: "test-hash-not-used",
	});
	await user.save();
	return user._id as mongoose.Types.ObjectId;
}

async function setup() {
	console.log("\n--- Setup ---");
	// Make the test authoritative about the index: rebuild from the current
	// schema so a database carrying the old (broken) definition is corrected
	// before we rely on it. This is what the race guard hinges on.
	await UnifiedBooking.syncIndexes();
	const idx = await UnifiedBooking.collection.indexes();
	const slotIdx = idx.find(
		(x) =>
			x.key?.expertId === 1 &&
			x.key?.bookingDate === 1 &&
			x.key?.startTime === 1,
	);
	assert(
		Boolean(slotIdx?.unique) &&
			slotIdx?.partialFilterExpression?.slotHold === true,
		`PT slot unique index is present and version-proof (pfe=${JSON.stringify(slotIdx?.partialFilterExpression ?? null)})`,
	);

	// ── Class + session (10 seats), dated inside the default 72h booking window.
	const cls = await ClassModel.create({
		name: `FX03 Class ${RUN}`,
		creditCost: 1,
		maxParticipants: CLASS_CAPACITY,
		status: "ACTIVE",
		isPublished: true,
		access: "open_to_all",
	});
	classId = cls._id.toString();

	const tomorrow = new Date();
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	tomorrow.setUTCHours(0, 0, 0, 0);
	const session = await ScheduledSession.create({
		classId,
		sessionDate: tomorrow,
		startTime: "10:00",
		endTime: "11:00",
		capacity: CLASS_CAPACITY,
		remainingCapacity: CLASS_CAPACITY,
		currentBookings: 0,
		status: "SCHEDULED",
	});
	sessionId = session._id.toString();

	// 50 class members, each with exactly 1 credit (so the accounting is exact).
	for (let i = 0; i < CONCURRENCY; i++) {
		const uid = await seedMember("class", i);
		classMemberIds.push(uid);
		await Membership.create({
			user: uid,
			planName: "FX03 Credit Pack",
			category: "GENERAL_MEMBERSHIP",
			creditsIncluded: 1,
			creditsRemaining: 1,
			status: MembershipStatus.Active,
			price: 0,
			currency: "INR",
			startDate: new Date(Date.now() - 3600_000),
			endDate: new Date(Date.now() + 30 * 24 * 3600_000),
		});
	}
	console.log(`  Seeded class ${classId}, session ${sessionId}, ${CONCURRENCY} members.`);

	// ── One trainer + 50 PT members, each with 1 PT session, locked to trainer.
	const trainer = await Trainer.create({
		trainerName: `FX03 Coach ${RUN}`,
		description: "FX-03 concurrency fixture",
		specialities: ["Strength"],
		email: `fx03-coach-${RUN}@${EMAIL_DOMAIN}`,
		phone: `7${RUN.slice(-9)}`.slice(0, 12),
		passwordHash: "test-hash-not-used",
		isActive: true,
	});
	trainerId = trainer._id as mongoose.Types.ObjectId;

	for (let i = 0; i < CONCURRENCY; i++) {
		const uid = await seedMember("pt", i);
		ptMemberIds.push(uid);
		await Membership.create({
			user: uid,
			planName: "FX03 PT Pack",
			category: "PERSONAL_TRAINING",
			ptSessionsIncluded: 1,
			ptSessionsRemaining: 1,
			ptSessionsUsed: 0,
			assignedTrainerId: trainer._id,
			assignedTrainerName: trainer.trainerName,
			status: MembershipStatus.Active,
			price: 0,
			currency: "INR",
			startDate: new Date(Date.now() - 3600_000),
			endDate: new Date(Date.now() + 30 * 24 * 3600_000),
		});
	}
	console.log(`  Seeded trainer ${trainerId}, ${CONCURRENCY} PT members.`);
}

async function testClass() {
	console.log("\n--- FX-03.1 / FX-03.3 (class) : 50 bookings for a 10-seat session ---");
	const results = await Promise.all(
		classMemberIds.map((uid) =>
			registerGroupClassBooking({ userId: uid.toString(), sessionId }).catch(
				(err) => ({ success: false, statusCode: 500, message: String(err) }),
			),
		),
	);

	const confirmed = results.filter((r) => r.success);
	const full = results.filter((r) => !r.success && r.statusCode === 409);
	console.log(
		`  confirmed=${confirmed.length} full(409)=${full.length} other=${results.length - confirmed.length - full.length}`,
	);
	assert(confirmed.length === CLASS_CAPACITY, `Exactly ${CLASS_CAPACITY} bookings confirmed`);
	assert(full.length === CONCURRENCY - CLASS_CAPACITY, `Exactly ${CONCURRENCY - CLASS_CAPACITY} refused with "class full" (409)`);

	const rows = await Bookings.countDocuments({
		sessionId,
		status: { $nin: ["Cancelled", "CANCELLED"] },
	});
	assert(rows === CLASS_CAPACITY, `Exactly ${CLASS_CAPACITY} booking rows exist for the session (found ${rows})`);

	const after = await ScheduledSession.findById(sessionId).lean();
	assert(after?.remainingCapacity === 0, "Session remainingCapacity is 0 (no overbooking, no underbooking)");
	assert(after?.currentBookings === CLASS_CAPACITY, `Session currentBookings is ${CLASS_CAPACITY}`);
	assert(after?.status === "FULL", "Session flipped to FULL");

	// FX-03.3 — credits: exactly one consume per confirmed, none per refused.
	const consumeTxns = await CreditTransaction.countDocuments({
		user: { $in: classMemberIds },
		type: CreditTransactionType.Consume,
		sourceType: CreditTransactionSource.Booking,
	});
	assert(consumeTxns === CLASS_CAPACITY, `Exactly ${CLASS_CAPACITY} credit-consume transactions (found ${consumeTxns})`);

	const spentMembers = await Membership.countDocuments({
		user: { $in: classMemberIds },
		creditsRemaining: 0,
	});
	const untouchedMembers = await Membership.countDocuments({
		user: { $in: classMemberIds },
		creditsRemaining: 1,
	});
	assert(spentMembers === CLASS_CAPACITY, `Exactly ${CLASS_CAPACITY} members were charged 1 credit`);
	assert(untouchedMembers === CONCURRENCY - CLASS_CAPACITY, `The other ${CONCURRENCY - CLASS_CAPACITY} members kept their credit (no charge on refusal)`);
}

async function testPersonalTraining() {
	console.log("\n--- FX-03.2 / FX-03.3 (PT) : 50 bookings for one trainer slot ---");
	const tomorrow = new Date();
	tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
	const bookingDate = tomorrow.toISOString().slice(0, 10);

	const settled = await Promise.allSettled(
		ptMemberIds.map((uid) =>
			createPersonalTrainingBooking({
				userId: uid.toString(),
				trainerId: String(trainerId),
				bookingDate,
				startTime: "07:00",
				endTime: "07:45",
				appointmentMode: AppointmentMode.ONLINE,
			}),
		),
	);

	const confirmed = settled.filter((s) => s.status === "fulfilled");
	const rejected = settled.filter((s) => s.status === "rejected");
	const slotConflicts = rejected.filter(
		(s) =>
			(s as PromiseRejectedResult).reason instanceof SlotConflictError ||
			(s as PromiseRejectedResult).reason?.name === "SlotConflictError",
	);
	console.log(
		`  confirmed=${confirmed.length} rejected=${rejected.length} (slot-conflict=${slotConflicts.length})`,
	);
	// Surface any unexpected rejection reason to make a failure diagnosable.
	for (const r of rejected) {
		const reason = (r as PromiseRejectedResult).reason;
		if (!(reason instanceof SlotConflictError) && reason?.name !== "SlotConflictError") {
			console.log(`    unexpected rejection: ${reason?.name}: ${reason?.message}`);
		}
	}
	assert(confirmed.length === 1, "Exactly 1 PT booking confirmed");
	assert(rejected.length === CONCURRENCY - 1, `Exactly ${CONCURRENCY - 1} PT bookings refused`);
	assert(slotConflicts.length === CONCURRENCY - 1, `All refusals are clean slot-conflicts (got ${slotConflicts.length})`);

	const start = new Date(`${bookingDate}T00:00:00.000Z`);
	const end = new Date(`${bookingDate}T23:59:59.999Z`);
	const activeRows = await UnifiedBooking.countDocuments({
		expertId: trainerId,
		bookingDate: { $gte: start, $lte: end },
		startTime: "07:00",
		status: {
			$in: [UnifiedBookingStatus.PENDING, UnifiedBookingStatus.CONFIRMED],
		},
	});
	assert(activeRows === 1, `Exactly 1 active UnifiedBooking row for the slot (found ${activeRows})`);

	// FX-03.3 — PT credits: one consume for the winner, none for the losers; and
	// every loser's PT quota was rolled back to 1 (the transaction aborted).
	const ptConsume = await CreditTransaction.countDocuments({
		user: { $in: ptMemberIds },
		type: CreditTransactionType.Consume,
		sourceType: CreditTransactionSource.PersonalTraining,
	});
	assert(ptConsume === 1, `Exactly 1 PT credit-consume transaction (found ${ptConsume})`);

	const quotaSpent = await Membership.countDocuments({
		user: { $in: ptMemberIds },
		ptSessionsRemaining: 0,
	});
	const quotaIntact = await Membership.countDocuments({
		user: { $in: ptMemberIds },
		ptSessionsRemaining: 1,
	});
	assert(quotaSpent === 1, "Exactly 1 member spent a PT session");
	assert(quotaIntact === CONCURRENCY - 1, `The other ${CONCURRENCY - 1} members' PT quota was rolled back (no charge on refusal)`);
}

async function cleanup() {
	console.log("\n--- Cleanup ---");
	const allMembers = [...classMemberIds, ...ptMemberIds];
	await Promise.all([
		Bookings.deleteMany({ sessionId }),
		ScheduledSession.deleteMany({ _id: sessionId || undefined }),
		ClassModel.deleteMany({ _id: classId || undefined }),
		UnifiedBooking.deleteMany({ userId: { $in: allMembers } }),
		CreditTransaction.deleteMany({ user: { $in: allMembers } }),
		Membership.deleteMany({ user: { $in: allMembers } }),
		User.deleteMany({ _id: { $in: allMembers } }),
		trainerId ? Trainer.deleteMany({ _id: trainerId }) : Promise.resolve(),
	]);
	console.log("  Removed all FX-03 fixtures.");
}

async function run() {
	console.log("=== FX-03: No double bookings when many book at once ===");
	const { close } = await startTestServer();
	try {
		requireReplicaSet();
		await setup();
		await testClass();
		await testPersonalTraining();
		console.log("\n✅ FX-03 PASSED — no overbooking, credits charged exactly once.");
	} finally {
		try {
			await cleanup();
		} catch (err) {
			console.error("  cleanup error (non-fatal):", err);
		}
		await close();
		await mongoose.connection.close();
	}
}

run().catch((err) => {
	console.error("\n❌ FX-03 FAILED:", err?.message || err);
	process.exitCode = 1;
});
