import type mongoose from "mongoose";
import { Types } from "mongoose";
import {
	NotificationChannel,
	NotificationKind,
	ReminderKind,
	ReminderStatus,
	MembershipStatus,
} from "../models/Enums";
import ScheduledReminder from "../models/ScheduledReminder";
import Membership from "../models/Membership";
import User from "../models/User";
import Admin from "../models/Admin";
import Notification from "../models/Notification";
import { notify } from "./notification.service";
import { expireStaleNutritionistBookings } from "./nutritionist-expiry.service";
import {
	expireDueRooms,
	prepareDueRooms,
	verifyHostPresence,
} from "./session-room-lifecycle.service";

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

// ─── Schedule ─────────────────────────────────────────────────────────────────

/**
 * Schedule T-24h, T-1h, T-15m reminders for an appointment.
 * Silently skips reminders where fireAt is already in the past.
 */
export async function scheduleReminders(
	appointmentId: mongoose.Types.ObjectId | string,
	userId: mongoose.Types.ObjectId | string,
	appointmentStart: Date,
	session?: mongoose.ClientSession,
): Promise<void> {
	const now = new Date();
	const aId =
		typeof appointmentId === "string"
			? new Types.ObjectId(appointmentId)
			: appointmentId;
	const uId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

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

	try {
		const ops = reminders.map((r) => ({
			updateOne: {
				filter: { appointmentId: r.appointmentId, kind: r.kind },
				update: {
					$set: {
						userId: r.userId,
						fireAt: r.fireAt,
						status: r.status,
						attempts: 0,
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

/** Cancel all pending reminders for an appointment */
export async function cancelReminders(
	appointmentId: mongoose.Types.ObjectId | string,
): Promise<void> {
	await ScheduledReminder.updateMany(
		{ appointmentId, status: ReminderStatus.Scheduled },
		{ $set: { status: ReminderStatus.Cancelled } },
	);
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

			await notify({
				userId: String(reminder.userId),
				kind: NotificationKind.AppointmentReminder,
				title: "Upcoming appointment",
				body: `Your appointment is in ${label}.`,
				data: {
					appointmentId: String(reminder.appointmentId),
					kind: reminder.kind,
				},
				channels: [NotificationChannel.Push, NotificationChannel.Socket],
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
