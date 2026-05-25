import type mongoose from "mongoose";
import {
	NotificationChannel,
	NotificationKind,
	ReminderKind,
	ReminderStatus,
} from "../models/Enums";
import ScheduledReminder from "../models/ScheduledReminder";
import { notify } from "./notification.service";

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

	const reminders = Object.entries(REMINDER_OFFSETS_MS)
		.map(([kind, offsetMs]) => ({
			appointmentId,
			userId,
			kind: kind as ReminderKind,
			fireAt: new Date(appointmentStart.getTime() - offsetMs),
			status: ReminderStatus.Scheduled,
		}))
		.filter((r) => r.fireAt > now);

	if (reminders.length === 0) return;

	try {
		await ScheduledReminder.insertMany(reminders, {
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
export async function processReminders(): Promise<{ fired: number; failed: number }> {
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
			console.error(`[reminder] Failed to fire reminder ${String(reminder._id)}`, err);

			await ScheduledReminder.findByIdAndUpdate(reminder._id, {
				$set: {
					status: ReminderStatus.Scheduled, // re-queue on failure
					lastError: err instanceof Error ? err.message : String(err),
				},
			});

			failed++;
		}
	}

	return { fired, failed };
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
