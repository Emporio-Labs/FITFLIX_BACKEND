import type mongoose from "mongoose";
import { Types } from "mongoose";
import Admin from "../models/Admin";
import Bookings from "../models/Bookings";
import Class from "../models/Class";
import {
	MembershipStatus,
	NotificationChannel,
	NotificationKind,
	ReminderKind,
	ReminderStatus,
	ServiceSubtype,
} from "../models/Enums";
import Membership from "../models/Membership";
import Notification from "../models/Notification";
import ScheduledReminder from "../models/ScheduledReminder";
import ScheduledSession from "../models/ScheduledSession";
import User from "../models/User";
import { expireMemberships } from "./membership-lifecycle.service";
import { notify } from "./notification.service";
import { expireStaleNutritionistBookings } from "./nutritionist-expiry.service";
import {
	expireDueRooms,
	prepareDueRooms,
	verifyHostPresence,
} from "./session-room-lifecycle.service";
import { expireStaleSportsScientistBookings } from "./sports-scientist-expiry.service";

const REMINDER_OFFSETS_MS: Record<ReminderKind, number> = {
	[ReminderKind.TMinus24H]: 24 * 60 * 60 * 1000,
	[ReminderKind.TMinus1H]: 60 * 60 * 1000,
	[ReminderKind.TMinus15M]: 15 * 60 * 1000,
};

const REMINDER_LABELS: Record<ReminderKind, string> = {
	[ReminderKind.TMinus24H]: "24 hours",
	[ReminderKind.TMinus1H]: "1 hour",
	[ReminderKind.TMinus15M]: "15 minutes",
};

export interface ReminderScheduleOptions {
	session?: mongoose.ClientSession | null;
	targetType?: "group_class" | "personal_training" | "consultation" | "therapy";
	sessionId?: string;
	classId?: string;
	sessionTitle?: string;
}

function isClientSession(
	val: unknown,
): val is mongoose.ClientSession {
	return Boolean(
		val &&
			typeof val === "object" &&
			"inTransaction" in (val as Record<string, unknown>),
	);
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

/**
 * Schedule T-24h, T-1h, T-15m reminders for an appointment/booking.
 * First cancels any previously scheduled reminders for the same appointmentId
 * so rescheduling to a nearer time never leaves stale reminders active, then
 * upserts all future reminder offsets.
 */
export async function scheduleReminders(
	appointmentId: mongoose.Types.ObjectId | string,
	userId: mongoose.Types.ObjectId | string,
	appointmentStart: Date | null | undefined,
	sessionOrOptions?: mongoose.ClientSession | ReminderScheduleOptions | null,
): Promise<void> {
	if (!appointmentStart || Number.isNaN(appointmentStart.getTime())) return;

	const now = new Date();
	const aId =
		typeof appointmentId === "string"
			? new Types.ObjectId(appointmentId)
			: appointmentId;
	const uId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

	const session = isClientSession(sessionOrOptions)
		? sessionOrOptions
		: (sessionOrOptions?.session ?? undefined);
	const opts: ReminderScheduleOptions = isClientSession(sessionOrOptions)
		? { session: sessionOrOptions }
		: (sessionOrOptions ?? {});

	try {
		// Cancel any existing SCHEDULED reminders first so rescheduling to a
		// closer window (where e.g. T-24h is now in the past) clears the old row.
		await ScheduledReminder.updateMany(
			{ appointmentId: aId, status: ReminderStatus.Scheduled },
			{ $set: { status: ReminderStatus.Cancelled } },
			session ? { session } : undefined,
		);

		const reminders = Object.entries(REMINDER_OFFSETS_MS)
			.map(([kind, offsetMs]) => ({
				appointmentId: aId,
				userId: uId,
				kind: kind as ReminderKind,
				fireAt: new Date(appointmentStart.getTime() - offsetMs),
				status: ReminderStatus.Scheduled,
			}))
			.filter((r) => r.fireAt > now);

		if (reminders.length === 0) return;

		const ops = reminders.map((r) => ({
			updateOne: {
				filter: { appointmentId: r.appointmentId, kind: r.kind },
				update: {
					$set: {
						userId: r.userId,
						fireAt: r.fireAt,
						status: r.status,
						attempts: 0,
						...(opts.targetType ? { targetType: opts.targetType } : {}),
						...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
						...(opts.classId ? { classId: opts.classId } : {}),
						...(opts.sessionTitle ? { sessionTitle: opts.sessionTitle } : {}),
					},
					$unset: { lastError: true as const },
				},
				upsert: true,
			},
		}));
		await ScheduledReminder.bulkWrite(ops, {
			ordered: false,
			...(session ? { session } : {}),
		});
	} catch (err) {
		console.error("[scheduleReminders] Partial failure", err);
	}
}

/** Cancel all pending reminders for an appointment/booking */
export async function cancelReminders(
	appointmentId: mongoose.Types.ObjectId | string,
	session?: mongoose.ClientSession | null,
): Promise<void> {
	try {
		const aId =
			typeof appointmentId === "string" && Types.ObjectId.isValid(appointmentId)
				? new Types.ObjectId(appointmentId)
				: appointmentId;
		await ScheduledReminder.updateMany(
			{ appointmentId: aId, status: ReminderStatus.Scheduled },
			{ $set: { status: ReminderStatus.Cancelled } },
			session ? { session } : undefined,
		);
	} catch (err) {
		console.error("[cancelReminders] Failed to cancel reminders", err);
	}
}

/**
 * FX-10: Send a "Live Now" alert within 10 seconds to everyone booked into a
 * group class / live stream session when the trainer starts the session.
 */
export async function notifySessionLiveNow(
	sessionId: mongoose.Types.ObjectId | string,
): Promise<{ notified: number }> {
	try {
		const sidStr = String(sessionId);
		const session = await ScheduledSession.findById(sidStr).lean();
		if (!session) return { notified: 0 };

		const classDoc = await Class.findById(session.classId)
			.select("name instructor")
			.lean();
		const className = (classDoc as any)?.name || "Group Class";
		const instructorName = (classDoc as any)?.instructor || "";

		const activeBookings = await Bookings.find({
			sessionId: sidStr,
			status: { $nin: ["Cancelled", "CANCELLED", 2] },
		})
			.select("_id user")
			.lean();

		if (activeBookings.length === 0) return { notified: 0 };

		await Promise.allSettled(
			activeBookings.map((booking) =>
				notify({
					userId: String(booking.user),
					kind: NotificationKind.SessionLiveNow,
					title: `${className} is Live Now!`,
					body: instructorName
						? `${instructorName} has started ${className}. Tap to join now!`
						: `Your trainer has started ${className}. Tap to join now!`,
					data: {
						appointmentId: String(booking._id),
						bookingId: String(booking._id),
						sessionId: sidStr,
						classId: String(session.classId),
						targetType: "group_class",
						sessionTitle: className,
					},
					channels: [
						NotificationChannel.InApp,
						NotificationChannel.Push,
						NotificationChannel.Socket,
					],
				}),
			),
		);

		return { notified: activeBookings.length };
	} catch (err) {
		console.error("[notifySessionLiveNow] Failed to fan out live alert", err);
		return { notified: 0 };
	}
}

/**
 * FX-10: Send a "Live Now" alert to the member when the trainer/expert joins
 * a 1:1 personal training or consultation room.
 */
export async function notifyOneOnOneLiveNow(booking: {
	_id: mongoose.Types.ObjectId | string;
	userId: mongoose.Types.ObjectId | string;
	serviceSubtype?: string | null;
	assignedExpertName?: string | null;
}): Promise<void> {
	try {
		const bookingIdStr = String(booking._id);
		const isPt = booking.serviceSubtype === ServiceSubtype.TRAINER;
		const targetType = isPt ? "personal_training" : "consultation";
		const expertLabel = booking.assignedExpertName?.trim()
			? booking.assignedExpertName.trim()
			: isPt
				? "Your trainer"
				: "Your specialist";
		const sessionTitle = isPt
			? `Personal Training with ${expertLabel}`
			: `Consultation with ${expertLabel}`;

		await notify({
			userId: String(booking.userId),
			kind: NotificationKind.SessionLiveNow,
			title: `${sessionTitle} is Live Now!`,
			body: `${expertLabel} has started your session. Tap to join now!`,
			data: {
				appointmentId: bookingIdStr,
				bookingId: bookingIdStr,
				sessionId: bookingIdStr,
				targetType,
				sessionTitle,
			},
			channels: [
				NotificationChannel.InApp,
				NotificationChannel.Push,
				NotificationChannel.Socket,
			],
		});
	} catch (err) {
		console.error("[notifyOneOnOneLiveNow] Failed to send live alert", err);
	}
}

// ─── Poller (one tick) ────────────────────────────────────────────────────────

/**
 * Process all due reminders.
 * Atomically claims each row before firing to prevent duplicate sends.
 * Safe to call from multiple instances concurrently.
 */
export async function processReminders(): Promise<{
	fired: number;
	failed: number;
}> {
	const now = new Date();
	let fired = 0;
	let failed = 0;

	// Collect due reminders
	const due = await ScheduledReminder.find({
		status: ReminderStatus.Scheduled,
		fireAt: { $lte: now },
	})
		.limit(100)
		.lean();

	for (const reminder of due) {
		// Atomic claim — prevents another instance from double-firing
		const claimed = await ScheduledReminder.findOneAndUpdate(
			{ _id: reminder._id, status: ReminderStatus.Scheduled },
			{ $set: { status: ReminderStatus.Fired }, $inc: { attempts: 1 } },
			{ returnDocument: "after" },
		);

		if (!claimed) continue; // Already claimed by another instance

		try {
			const label = REMINDER_LABELS[reminder.kind as ReminderKind] ?? "soon";
			const sessionTitle = (reminder as any).sessionTitle as string | undefined;
			const targetType = (reminder as any).targetType as string | undefined;
			const sessionId = (reminder as any).sessionId as string | undefined;
			const classId = (reminder as any).classId as string | undefined;

			await notify({
				userId: String(reminder.userId),
				kind: NotificationKind.AppointmentReminder,
				title: sessionTitle ? `Upcoming: ${sessionTitle}` : "Upcoming Session",
				body: sessionTitle
					? `Your ${sessionTitle} starts in ${label}.`
					: `Your booked session starts in ${label}.`,
				data: {
					appointmentId: String(reminder.appointmentId),
					bookingId: String(reminder.appointmentId),
					kind: reminder.kind,
					reminderKind: reminder.kind,
					...(targetType ? { targetType } : {}),
					...(sessionId ? { sessionId } : {}),
					...(classId ? { classId } : {}),
					...(sessionTitle ? { sessionTitle } : {}),
				},
				channels: [
					NotificationChannel.InApp,
					NotificationChannel.Push,
					NotificationChannel.Socket,
				],
			});

			fired++;
		} catch (err) {
			console.error(
				`[reminder] Failed to fire reminder ${String(reminder._id)}`,
				err,
			);

			await ScheduledReminder.findByIdAndUpdate(reminder._id, {
				$set: {
					status: ReminderStatus.Scheduled, // re-queue on failure
					lastError: err instanceof Error ? err.message : String(err),
				},
			});

			failed++;
		}
	}

	// Run membership expiry checks
	try {
		await checkMembershipExpiries();
	} catch (err) {
		console.error("[reminder-poller] checkMembershipExpiries failed", err);
	}

	// Auto-expire stale nutritionist bookings: PENDING past its start time, and
	// ACCEPTED past its end time + grace where the meeting never happened.
	try {
		await expireStaleNutritionistBookings(now);
	} catch (err) {
		console.error(
			"[reminder-poller] expireStaleNutritionistBookings failed",
			err,
		);
	}

	// Same two rules for sports-scientist consultations, now that they live in
	// UnifiedBooking alongside the nutritionist consult.
	try {
		await expireStaleSportsScientistBookings(now);
	} catch (err) {
		console.error(
			"[reminder-poller] expireStaleSportsScientistBookings failed",
			err,
		);
	}

	// Group-class / live-stream room lifecycle: stamp room IDs at (start -
	// lead), tear rooms down at (end + grace). Piggybacking on this poller
	// gives non-serverless deployments a minute-granularity tick for free,
	// alongside the external caller that drives /internal/sessions/lifecycle/tick
	// on Vercel (whose own cron only fires daily).
	try {
		await prepareDueRooms(now);
		await verifyHostPresence(now);
		await expireDueRooms(now);
	} catch (err) {
		console.error("[reminder-poller] session room lifecycle sweep failed", err);
	}

	// Membership expiry. Throttled to hourly rather than riding the 60s tick —
	// expiry is date-granular, so a minute-by-minute sweep would be pure load.
	// Access is never stale in the meantime: every gating query carries its own
	// date bounds (utils/membership-status.util.ts), so a membership that
	// lapsed since the last sweep is already refused.
	if (now.getTime() - lastMembershipExpirySweep >= MEMBERSHIP_EXPIRY_INTERVAL_MS) {
		lastMembershipExpirySweep = now.getTime();
		try {
			await expireMemberships(now);
		} catch (err) {
			console.error("[reminder-poller] membership expiry sweep failed", err);
		}
	}

	return { fired, failed };
}

/**
 * Scan all active memberships expiring in the next 30 days.
 * Send daily notifications to all admins about expiring member details.
 */
export async function checkMembershipExpiries(): Promise<void> {
	const now = new Date();
	const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

	// Find active memberships expiring in the next 30 days
	const expiringMemberships = await Membership.find({
		status: MembershipStatus.Active,
		endDate: { $gt: now, $lte: thirtyDaysFromNow },
	});

	if (expiringMemberships.length === 0) return;

	// Get all admins
	const admins = await Admin.find({});
	if (admins.length === 0) return;

	const startOfToday = new Date();
	startOfToday.setHours(0, 0, 0, 0);

	for (const membership of expiringMemberships) {
		// Get member user details
		const member = await User.findById(membership.user);
		if (!member) continue;

		const diffTime = membership.endDate!.getTime() - now.getTime();
		const daysRemaining = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));

		for (const admin of admins) {
			// Check if alert already sent today for this admin and this membership
			const exists = await Notification.findOne({
				userId: admin._id,
				kind: NotificationKind.MembershipExpiryReminder,
				"data.membershipId": membership._id.toString(),
				createdAt: { $gte: startOfToday },
			});

			if (!exists) {
				await notify({
					userId: admin._id.toString(),
					kind: NotificationKind.MembershipExpiryReminder,
					title: "Membership Expiring Soon",
					body: `Member ${member.username} (${member.email || member.phone})'s ${membership.planName} membership is expiring in ${daysRemaining} day${daysRemaining > 1 ? "s" : ""} (on ${new Date(membership.endDate!).toLocaleDateString()}).`,
					data: {
						membershipId: membership._id.toString(),
						userId: member._id.toString(),
						expiryDate: membership.endDate!.toISOString(),
						daysRemaining: String(daysRemaining),
					},
					channels: [NotificationChannel.InApp, NotificationChannel.Socket],
				});
			}
		}
	}
}

// ─── In-process interval (non-serverless) ────────────────────────────────────

let pollerTimer: ReturnType<typeof setInterval> | null = null;

// Set to 0 so the first tick after boot always sweeps.
let lastMembershipExpirySweep = 0;
const MEMBERSHIP_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;

export function startReminderPoller(intervalMs = 60_000): void {
	if (pollerTimer) return; // already running

	pollerTimer = setInterval(() => {
		processReminders().catch((err) =>
			console.error("[reminder-poller] tick failed", err),
		);
	}, intervalMs);

	console.log(`[reminder-poller] Started with interval ${intervalMs}ms`);
}

export function stopReminderPoller(): void {
	if (pollerTimer) {
		clearInterval(pollerTimer);
		pollerTimer = null;
	}
}
