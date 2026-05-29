import crypto from "node:crypto";
import AppointmentAuditLog from "../../models/AppointmentAuditLog";
import ExpertAppointment from "../../models/ExpertAppointment";
import {
	AppointmentBookingStatus,
	AuditAction,
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
import { expertTypeFromEventTypeId } from "./calid.mapper";
import type { CalIdWebhookPayload } from "./calid.types";

const MAX_ATTEMPTS = 5;
const PROCESSING_TIMEOUT_MS = 60_000;

// ─── Signature verification ───────────────────────────────────────────────────

export function verifyCalIdSignature(
	rawBody: Buffer,
	signatureHeader: string | undefined,
): boolean {
	const secret = process.env.CALID_WEBHOOK_SECRET;
	if (!secret) {
		console.warn("[calid-webhook] CALID_WEBHOOK_SECRET not set — skipping verification");
		return true;
	}

	if (!signatureHeader) return false;

	const expected = crypto
		.createHmac("sha256", secret)
		.update(rawBody)
		.digest("hex");

	const provided = signatureHeader.replace(/^sha256=/, "");
	if (provided.length !== expected.length) return false;

	const expectedBuf = Buffer.from(expected, "hex");
	const providedBuf = Buffer.from(provided, "hex");
	if (expectedBuf.length !== providedBuf.length) return false;

	return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// ─── Main entry point (called by controller) ─────────────────────────────────

export async function handleCalIdWebhook(
	payload: CalIdWebhookPayload,
	deliveryId: string,
): Promise<void> {
	const receivedAt = new Date();

	const webhookEvent = await WebhookEvent.findOneAndUpdate(
		{ eventId: deliveryId },
		{
			$setOnInsert: {
				provider: "calid",
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

	if (webhookEvent.status === WebhookEventStatus.Processed) {
		return;
	}

	const stuckThreshold = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
	const isStuck =
		webhookEvent.status === WebhookEventStatus.Processing &&
		webhookEvent.receivedAt < stuckThreshold;

	if (webhookEvent.status === WebhookEventStatus.Processing && !isStuck) {
		return;
	}

	const claimed = await WebhookEvent.findOneAndUpdate(
		{ eventId: deliveryId, status: { $in: [WebhookEventStatus.Received, WebhookEventStatus.Failed] } },
		{ $set: { status: WebhookEventStatus.Processing } },
		{ returnDocument: "after" },
	);

	if (!claimed) return;

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

		if (newStatus !== WebhookEventStatus.DLQ) {
			throw err;
		}
	}
}

// ─── Event dispatcher ─────────────────────────────────────────────────────────

async function dispatchWebhookEvent(payload: CalIdWebhookPayload): Promise<void> {
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
			console.warn(`[calid-webhook] Unknown triggerEvent: ${triggerEvent}`);
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleBookingConfirmed(
	booking: CalIdWebhookPayload["payload"],
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calIdBookingId: booking.uid,
	});

	if (!appointment) {
		console.warn(`[calid-webhook] CONFIRMED: no appointment for uid=${booking.uid}`);
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
					meetingLink: booking.meetingUrl, // Mapped for backward compat
					appointmentStart: new Date(booking.startTime),
					appointmentEnd: new Date(booking.endTime),
					appointmentDate: new Date(booking.startTime), // Mapped for backward compat
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
	booking: CalIdWebhookPayload["payload"],
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calIdBookingId: booking.uid,
	});

	if (!appointment) {
		console.warn(`[calid-webhook] RESCHEDULED: no appointment for uid=${booking.uid}`);
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
					appointmentDate: new Date(booking.startTime), // Mapped for backward compat
					meetingUrl: booking.meetingUrl ?? appointment.meetingUrl,
					meetingLink: booking.meetingUrl ?? appointment.meetingUrl ?? appointment.meetingLink, // Mapped for backward compat
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
	booking: CalIdWebhookPayload["payload"],
	triggerEvent: string,
): Promise<void> {
	const appointment = await ExpertAppointment.findOne({
		calIdBookingId: booking.uid,
	});

	if (!appointment) {
		console.warn(`[calid-webhook] CANCELLED: no appointment for uid=${booking.uid}`);
		return;
	}

	if (appointment.bookingStatus === AppointmentBookingStatus.Cancelled) {
		return;
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

	const expertType = expertTypeFromEventTypeId(booking.eventTypeId);
	if (expertType) {
		await cancelExpertAppointment(
			String(appointment.userId),
			expertType,
		).catch((err) =>
			console.error("[calid-webhook] cancelExpertAppointment rewind failed", err),
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
