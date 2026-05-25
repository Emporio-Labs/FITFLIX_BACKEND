import crypto from "node:crypto";
import mongoose from "mongoose";
import AppointmentAuditLog from "../../models/AppointmentAuditLog";
import ExpertAppointment from "../../models/ExpertAppointment";
import {
	AppointmentBookingStatus,
	AuditAction,
	ExpertType,
	NotificationChannel,
	NotificationKind,
	WebhookEventStatus,
	WebhookSyncStatus,
} from "../../models/Enums";
import WebhookEvent from "../../models/WebhookEvent";
import { fanOutToAdmin, notify } from "../../services/notification.service";
import { cancelReminders } from "../../services/reminder.service";
import { emitToFrontDesk, emitToUser } from "../../services/realtime.service";
import { cancelExpertAppointment } from "../../utils/onboarding.service";
import { withOptionalTransaction } from "../../utils/transaction";
import { expertTypeFromEventTypeId, mapCalBookingToAppointmentFields } from "./calcom.mapper";
import type { CalcomWebhookPayload } from "./calcom.types";

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 60_000; // reclaim stuck PROCESSING rows after 60s

// ─── Signature verification ───────────────────────────────────────────────────

export function verifyCalcomSignature(
	rawBody: Buffer,
	signatureHeader: string | undefined,
): boolean {
	const secret = process.env.CAL_WEBHOOK_SECRET;
	if (!secret) {
		console.warn("[calcom-webhook] CAL_WEBHOOK_SECRET not set — skipping verification");
		return false;
	}

	if (!signatureHeader) return false;

	const expected = crypto
		.createHmac("sha256", secret)
		.update(rawBody)
		.digest("hex");

	const provided = signatureHeader.replace(/^sha256=/, "");

	return crypto.timingSafeEqual(
		Buffer.from(expected, "hex"),
		Buffer.from(provided.padEnd(expected.length, "0").slice(0, expected.length), "hex"),
	);
}

// ─── Main entry point (called by controller) ─────────────────────────────────

export async function handleCalcomWebhook(
	payload: CalcomWebhookPayload,
	deliveryId: string, // Cal.com webhook delivery UID for idempotency
): Promise<void> {
	const receivedAt = new Date();

	// 1. Upsert idempotency record
	const webhookEvent = await WebhookEvent.findOneAndUpdate(
		{ eventId: deliveryId },
		{
			$setOnInsert: {
				provider: "calcom",
				eventId: deliveryId,
				triggerEvent: payload.triggerEvent,
				payload,
				status: WebhookEventStatus.Received,
				attempts: 0,
				receivedAt,
			},
		},
		{ upsert: true, returnDocument: "after" },
	);

	// 2. Already processed → idempotent no-op
	if (webhookEvent.status === WebhookEventStatus.Processed) {
		return;
	}

	// 3. Reclaim stuck PROCESSING rows (from crashed handler)
	const stuckThreshold = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
	const isStuck =
		webhookEvent.status === WebhookEventStatus.Processing &&
		webhookEvent.receivedAt < stuckThreshold;

	if (webhookEvent.status === WebhookEventStatus.Processing && !isStuck) {
		// Another handler is currently processing — skip
		return;
	}

	// 4. Atomically claim for processing
	const claimed = await WebhookEvent.findOneAndUpdate(
		{ eventId: deliveryId, status: { $in: [WebhookEventStatus.Received, WebhookEventStatus.Failed] } },
		{ $set: { status: WebhookEventStatus.Processing } },
		{ returnDocument: "after" },
	);

	if (!claimed) return; // Race — another instance claimed it

	try {
		await dispatchWebhookEvent(payload);

		await WebhookEvent.findByIdAndUpdate(claimed._id, {
			$set: { status: WebhookEventStatus.Processed, processedAt: new Date() },
		});
	} catch (err) {
		const attempts = (claimed.attempts ?? 0) + 1;
		const newStatus = attempts >= MAX_ATTEMPTS ? WebhookEventStatus.DLQ : WebhookEventStatus.Failed;

		await WebhookEvent.findByIdAndUpdate(claimed._id, {
			$set: {
				status: newStatus,
				attempts,
				lastError: err instanceof Error ? err.message : String(err),
			},
		});

		// Re-throw so the HTTP handler returns 5xx and Cal.com retries
		if (newStatus !== WebhookEventStatus.DLQ) {
			throw err;
		}
		// DLQ — return 200 to stop Cal.com retrying (we've given up on this event)
	}
}

// ─── Event dispatcher ─────────────────────────────────────────────────────────

async function dispatchWebhookEvent(payload: CalcomWebhookPayload): Promise<void> {
	const { triggerEvent } = payload;
	const booking = payload.payload;

	switch (triggerEvent) {
		case "BOOKING_CREATED":
		case "BOOKING_CONFIRMED":
			await handleBookingConfirmed(booking);
			break;
		case "BOOKING_RESCHEDULED":
			await handleBookingRescheduled(booking);
			break;
		case "BOOKING_CANCELLED":
		case "BOOKING_REJECTED":
			await handleBookingCancelled(booking, triggerEvent);
			break;
		default:
			console.warn(`[calcom-webhook] Unknown triggerEvent: ${triggerEvent}`);
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleBookingConfirmed(
	booking: CalcomWebhookPayload["payload"],
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calComBookingId: booking.uid,
	});

	if (!appointment) {
		// Webhook arrived before our booking response was saved — wait briefly and retry
		console.warn(`[calcom-webhook] CONFIRMED: no appointment for uid=${booking.uid}`);
		return;
	}

	const now = new Date();

	await withOptionalTransaction(async (session) => {
		await ExpertAppointment.findByIdAndUpdate(
			appointment._id,
			{
				$set: {
					bookingStatus: AppointmentBookingStatus.Confirmed,
					meetingUrl: booking.meetingUrl,
					appointmentStart: new Date(booking.startTime),
					appointmentEnd: new Date(booking.endTime),
					webhookSyncStatus: WebhookSyncStatus.Synced,
					lastSyncedAt: now,
				},
			},
			{ session },
		);

		await AppointmentAuditLog.create(
			[
				{
					appointmentId: appointment._id,
					userId: appointment.userId,
					action: AuditAction.WebhookSync,
					actor: "webhook",
					calBookingId: booking.uid,
					after: { bookingStatus: AppointmentBookingStatus.Confirmed, meetingUrl: booking.meetingUrl },
					payload: booking,
				},
			],
			{ session },
		);
	});

	emitToUser(String(appointment.userId), "appointment_booked", {
		appointmentId: String(appointment._id),
	});
	fanOutToAdmin("appointment_created", {
		appointmentId: String(appointment._id),
		userId: String(appointment.userId),
	});
}

async function handleBookingRescheduled(
	booking: CalcomWebhookPayload["payload"],
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calComBookingId: booking.uid,
	});

	if (!appointment) {
		console.warn(`[calcom-webhook] RESCHEDULED: no appointment for uid=${booking.uid}`);
		return;
	}

	const now = new Date();
	const oldStart = appointment.appointmentStart;

	await withOptionalTransaction(async (session) => {
		await ExpertAppointment.findByIdAndUpdate(
			appointment._id,
			{
				$set: {
					bookingStatus: AppointmentBookingStatus.Rescheduled,
					appointmentStart: new Date(booking.startTime),
					appointmentEnd: new Date(booking.endTime),
					meetingUrl: booking.meetingUrl ?? appointment.meetingUrl,
					webhookSyncStatus: WebhookSyncStatus.Synced,
					lastSyncedAt: now,
				},
			},
			{ session },
		);

		await AppointmentAuditLog.create(
			[
				{
					appointmentId: appointment._id,
					userId: appointment.userId,
					action: AuditAction.Rescheduled,
					actor: "webhook",
					calBookingId: booking.uid,
					before: { appointmentStart: oldStart },
					after: { appointmentStart: new Date(booking.startTime) },
					payload: booking,
				},
			],
			{ session },
		);
	});

	// Refresh reminders
	await cancelReminders(appointment._id).catch(() => {});
	if (booking.startTime) {
		const { scheduleReminders } = await import("../../services/reminder.service");
		await scheduleReminders(
			appointment._id,
			appointment.userId,
			new Date(booking.startTime),
		).catch(() => {});
	}

	notify({
		userId: String(appointment.userId),
		kind: NotificationKind.AppointmentRescheduled,
		title: "Appointment rescheduled",
		body: "Your appointment time has been updated.",
		data: { appointmentId: String(appointment._id) },
		channels: [NotificationChannel.InApp, NotificationChannel.Push, NotificationChannel.Socket],
	}).catch(() => {});

	fanOutToAdmin("appointment_created", {
		appointmentId: String(appointment._id),
		userId: String(appointment.userId),
	});
}

async function handleBookingCancelled(
	booking: CalcomWebhookPayload["payload"],
	triggerEvent: string,
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calComBookingId: booking.uid,
	});

	if (!appointment) {
		console.warn(`[calcom-webhook] CANCELLED: no appointment for uid=${booking.uid}`);
		return;
	}

	if (appointment.bookingStatus === AppointmentBookingStatus.Cancelled) {
		return; // Already cancelled locally — idempotent
	}

	const now = new Date();

	await withOptionalTransaction(async (session) => {
		await ExpertAppointment.findByIdAndUpdate(
			appointment._id,
			{
				$set: {
					bookingStatus: AppointmentBookingStatus.Cancelled,
					cancelledAt: now,
					cancelReason: booking.cancellationReason ?? triggerEvent,
					webhookSyncStatus: WebhookSyncStatus.Synced,
					lastSyncedAt: now,
				},
			},
			{ session },
		);

		await AppointmentAuditLog.create(
			[
				{
					appointmentId: appointment._id,
					userId: appointment.userId,
					action: AuditAction.Cancelled,
					actor: "webhook",
					calBookingId: booking.uid,
					payload: booking,
				},
			],
			{ session },
		);
	});

	// Rewind onboarding step
	const expertType = expertTypeFromEventTypeId(booking.eventTypeId);
	if (expertType) {
		await cancelExpertAppointment(
			String(appointment.userId),
			expertType,
		).catch((err) =>
			console.error("[calcom-webhook] cancelExpertAppointment rewind failed", err),
		);
	}

	await cancelReminders(appointment._id).catch(() => {});

	notify({
		userId: String(appointment.userId),
		kind: NotificationKind.AppointmentCancelled,
		title: "Appointment cancelled",
		body: "Your appointment has been cancelled.",
		data: { appointmentId: String(appointment._id) },
		channels: [NotificationChannel.InApp, NotificationChannel.Push, NotificationChannel.Socket],
	}).catch(() => {});

	fanOutToAdmin("slot_released", {
		appointmentId: String(appointment._id),
		userId: String(appointment.userId),
	});
	emitToFrontDesk("onboarding_progress_changed", {
		userId: String(appointment.userId),
	});
}
