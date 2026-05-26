import type { RequestHandler } from "express";
import mongoose from "mongoose";
import AppointmentAuditLog from "../models/AppointmentAuditLog";
import ExpertAppointment from "../models/ExpertAppointment";
import {
	AppointmentBookingStatus,
	AuditAction,
	ExpertType,
	NotificationChannel,
	NotificationKind,
	OnboardingStep,
	WebhookSyncStatus,
} from "../models/Enums";
import User from "../models/User";
import { fanOutToAdmin, notify } from "../services/notification.service";
import { cancelReminders, scheduleReminders } from "../services/reminder.service";
import { emitToFrontDesk, emitToUser } from "../services/realtime.service";
import {
	CalIdError,
	CalIdSlotUnavailableError,
	CalIdTimeoutError,
} from "../integrations/calid/calid.types";
import * as calidService from "../integrations/calid/calid.service";
import { mapCalBookingToAppointmentFields } from "../integrations/calid/calid.mapper";
import { buildIdempotencyKey } from "../integrations/calid/calid.utils";
import type { AuthenticatedUser } from "../types/auth";
import { withOptionalTransaction } from "../utils/transaction";
import {
	advanceStep,
	cancelExpertAppointment,
	validateStepAllowed,
} from "../utils/onboarding.service";
import {
	adminListQuerySchema,
	availabilityQuerySchema,
	bookAppointmentSchema,
	cancelAppointmentSchema,
	rescheduleAppointmentSchema,
} from "../validators/expert-appointment.validator";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ACTIVE_STATUSES = [
	AppointmentBookingStatus.Pending,
	AppointmentBookingStatus.Confirmed,
	AppointmentBookingStatus.Rescheduled,
];

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};
	for (const issue of issues) {
		const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		if (!details[field]) details[field] = issue.message;
	}
	return details;
};

const getIdParam = (v: unknown): string | null => {
	if (typeof v !== "string" || !mongoose.Types.ObjectId.isValid(v)) return null;
	return v;
};

function stepForExpertType(expertType: ExpertType): OnboardingStep {
	return expertType === ExpertType.SportsScientist
		? OnboardingStep.SPORTS_SCIENTIST_BOOKING
		: OnboardingStep.NUTRITIONIST_BOOKING;
}

// ─── GET /expert-appointments/availability ────────────────────────────────────

export const getAvailability: RequestHandler = async (req, res, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const parsed = availabilityQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { expertType, startDate, endDate, timezone } = parsed.data;

	try {
		const days = await calidService.fetchAvailability(
			expertType as ExpertType,
			startDate,
			endDate,
			timezone,
		);
		res.status(200).json({ days });
	} catch (err) {
		if (err instanceof CalIdTimeoutError) {
			res.status(504).json({ error: "Scheduling service timed out", code: "PROVIDER_TIMEOUT" });
			return;
		}
		if (err instanceof CalIdError) {
			console.error("[CalIdError Details] Message:", err.message, "Status Code:", err.statusCode, "Details:", JSON.stringify(err.body));
			res.status(502).json({
				error: "Scheduling service error",
				code: "PROVIDER_ERROR",
				details: {
					message: err.message,
					statusCode: err.statusCode,
					response: err.body
				}
			});
			return;
		}
		next(err);
	}
};

// ─── POST /expert-appointments/book ───────────────────────────────────────────

export const bookAppointment: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "user") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const parsed = bookAppointmentSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { expertType, slotStart, timezone } = parsed.data;
	const idempotencyKey =
		parsed.data.idempotencyKey ?? buildIdempotencyKey(user.id, expertType, slotStart);

	// 1. Race guard — reject if active booking already exists
	const existingActive = await ExpertAppointment.findOne({
		userId: user.id,
		expertType,
		bookingStatus: { $in: ACTIVE_STATUSES },
	}).lean();

	if (existingActive) {
		res.status(409).json({
			error: "An active booking already exists for this expert type",
			code: "DUPLICATE_BOOKING",
		});
		return;
	}

	// 2. Validate onboarding step
	try {
		await validateStepAllowed(user.id, stepForExpertType(expertType as ExpertType));
	} catch (err: unknown) {
		if (err instanceof Error && "code" in err) {
			const svcErr = err as { code: string; message: string };
			const statusMap: Record<string, number> = {
				STEP_NOT_ALLOWED: 403,
				ALREADY_COMPLETED: 409,
				MISSING_STEPS: 400,
				NOT_FOUND: 404,
			};
			res.status(statusMap[svcErr.code] ?? 400).json({
				error: svcErr.message,
				code: svcErr.code,
			});
			return;
		}
		next(err);
		return;
	}

	// 3. Fetch user details for Cal ID attendee payload
	const dbUser = await User.findById(user.id).select("username email").lean();
	if (!dbUser) {
		res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
		return;
	}

	// 4. Insert pending appointment as reservation (idempotency key prevents duplicates)
	let pendingAppointment: (typeof ExpertAppointment extends mongoose.Model<infer D> ? D : never) & { _id: mongoose.Types.ObjectId };
	try {
		pendingAppointment = await ExpertAppointment.create({
			userId: user.id,
			expertType,
			bookingStatus: AppointmentBookingStatus.Pending,
			timezone,
			idempotencyKey,
			appointmentSource: "USER_APP",
			webhookSyncStatus: WebhookSyncStatus.Pending,
		}) as typeof pendingAppointment;
	} catch (err: unknown) {
		// Duplicate idempotency key — idempotent response: find and return existing
		if (
			err instanceof Error &&
			"code" in err &&
			(err as { code: number }).code === 11000
		) {
			const existing = await ExpertAppointment.findOne({ idempotencyKey }).lean();
			res.status(200).json({
				message: "Appointment already created (idempotent)",
				appointment: existing,
			});
			return;
		}
		next(err);
		return;
	}

	// 5. Call Cal ID (outside transaction — external I/O)
	let calBooking: Awaited<ReturnType<typeof calidService.createBooking>>;
	try {
		calBooking = await calidService.createBooking({
			expertType: expertType as ExpertType,
			slotStart,
			timezone,
			attendee: { name: dbUser.username, email: dbUser.email },
			userId: user.id,
		});
	} catch (err) {
		// Cal ID failed — delete the pending reservation
		await ExpertAppointment.findByIdAndDelete(pendingAppointment._id).catch(() => {});

		if (err instanceof CalIdSlotUnavailableError) {
			res.status(409).json({
				error: "The selected slot is no longer available",
				code: "SLOT_UNAVAILABLE",
			});
			return;
		}
		if (err instanceof CalIdTimeoutError) {
			res.status(504).json({ error: "Scheduling service timed out", code: "PROVIDER_TIMEOUT" });
			return;
		}
		if (err instanceof CalIdError) {
			console.error("[CalIdBookError Details] Message:", err.message, "Status Code:", err.statusCode, "Body:", JSON.stringify(err.body));
			res.status(502).json({
				error: "Scheduling service error",
				code: "PROVIDER_ERROR",
				...(process.env.NODE_ENV !== "production" && {
					details: {
						message: err.message,
						statusCode: err.statusCode,
						response: err.body,
					},
				}),
			});
			return;
		}
		console.error("[Unexpected Booking Error]", err);
		res.status(502).json({ error: "Scheduling service error", code: "PROVIDER_ERROR" });
		return;
	}

	// 6. Persist Cal ID data + advance onboarding (in optional transaction)
	const calFields = mapCalBookingToAppointmentFields(calBooking);

	try {
		await withOptionalTransaction(async (session) => {
			// Update appointment to Confirmed
			await ExpertAppointment.findByIdAndUpdate(
				pendingAppointment._id,
				{
					$set: {
						bookingStatus: AppointmentBookingStatus.Confirmed,
						webhookSyncStatus: WebhookSyncStatus.Pending,
						...calFields,
					},
				},
				{ session },
			);

			// Audit log
			await AppointmentAuditLog.create(
				[
					{
						appointmentId: pendingAppointment._id,
						userId: user.id,
						action: AuditAction.Booked,
						actor: "user",
						actorId: user.id,
						calBookingId: calFields.calIdBookingId,
						after: { ...calFields, bookingStatus: AppointmentBookingStatus.Confirmed },
					},
				],
				{ session },
			);

			// Advance onboarding step
			await advanceStep(user.id, stepForExpertType(expertType as ExpertType));
		});
	} catch (err) {
		// DB update failed after Cal ID succeeded — log orphan for sweeper
		console.error(
			`[bookAppointment] DB update failed for calBookingId=${calFields.calIdBookingId}. ` +
			`Appointment ${String(pendingAppointment._id)} may be orphaned.`,
			err,
		);
		// Don't delete the pending doc — the sweeper will reconcile via getBooking
		next(err);
		return;
	}

	// 7. Schedule reminders (best-effort)
	if (calFields.appointmentStart) {
		await scheduleReminders(
			pendingAppointment._id,
			user.id,
			calFields.appointmentStart,
		).catch((err) => console.error("[bookAppointment] scheduleReminders failed", err));
	}

	// 8. Fan-out notifications + realtime (best-effort, never blocks response)
	const appointmentSnapshot = { _id: pendingAppointment._id, expertType, ...calFields };

	notify({
		userId: user.id,
		kind: NotificationKind.AppointmentBooked,
		title: "Appointment confirmed",
		body: `Your ${expertType === ExpertType.SportsScientist ? "sports scientist" : "nutritionist"} appointment is confirmed.`,
		data: { appointmentId: String(pendingAppointment._id), expertType },
		channels: [NotificationChannel.InApp, NotificationChannel.Push, NotificationChannel.Socket],
	}).catch((err) => console.error("[bookAppointment] notify failed", err));

	fanOutToAdmin(
		"appointment_created",
		{ ...appointmentSnapshot, userId: user.id },
		expertType === ExpertType.Nutritionist ? "frontdesk" : undefined,
	);

	emitToUser(user.id, "onboarding_step_updated", {
		step: stepForExpertType(expertType as ExpertType),
	});

	const confirmedAppointment = await ExpertAppointment.findById(pendingAppointment._id).lean();
	res.status(201).json({ message: "Appointment booked", appointment: confirmedAppointment });
};

// ─── GET /expert-appointments/me ──────────────────────────────────────────────

export const getMyAppointments: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "user") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	try {
		const now = new Date();
		const appointments = await ExpertAppointment.find({ userId: user.id })
			.sort({ createdAt: -1 })
			.lean();

		const upcoming = appointments.filter(
			(a) =>
				ACTIVE_STATUSES.includes(a.bookingStatus as AppointmentBookingStatus) &&
				a.appointmentStart &&
				new Date(a.appointmentStart) >= now,
		);
		const completed = appointments.filter(
			(a) => a.bookingStatus === AppointmentBookingStatus.Completed,
		);
		const cancelled = appointments.filter(
			(a) => a.bookingStatus === AppointmentBookingStatus.Cancelled,
		);
		const missed = appointments.filter(
			(a) =>
				ACTIVE_STATUSES.includes(a.bookingStatus as AppointmentBookingStatus) &&
				a.appointmentStart &&
				new Date(a.appointmentStart) < now,
		);

		res.status(200).json({ upcoming, completed, cancelled, missed });
	} catch (err) {
		next(err);
	}
};

// ─── PATCH /expert-appointments/:id/reschedule ────────────────────────────────

export const rescheduleAppointment: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "user") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid appointment ID", code: "BAD_REQUEST" });
		return;
	}

	const parsed = rescheduleAppointmentSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { slotStart, timezone, reason } = parsed.data;

	try {
		const appointment = await ExpertAppointment.findById(id);
		if (!appointment) {
			res.status(404).json({ error: "Appointment not found", code: "NOT_FOUND" });
			return;
		}

		// Ownership check
		if (!appointment.userId.equals(user.id)) {
			res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
			return;
		}

		// State check
		if (!ACTIVE_STATUSES.includes(appointment.bookingStatus as AppointmentBookingStatus)) {
			res.status(409).json({
				error: "Only active appointments can be rescheduled",
				code: "INVALID_STATE",
			});
			return;
		}

		if (!appointment.calIdBookingId) {
			res.status(409).json({
				error: "Appointment has no Cal ID booking to reschedule",
				code: "INVALID_STATE",
			});
			return;
		}

		const oldStart = appointment.appointmentStart;
		const calBooking = await calidService.rescheduleBooking(
			{
				calBookingId: appointment.calIdEventId ?? appointment.calIdBookingId,
				calBookingUid: appointment.calIdBookingId,
				calEventTypeId: appointment.calIdEventTypeId,
				newSlotStart: slotStart,
				timezone,
				reason,
				rescheduledBy: user.email,
			},
		);

		const calFields = mapCalBookingToAppointmentFields(calBooking);

		await withOptionalTransaction(async (session) => {
			const before = appointment.toObject();

			await ExpertAppointment.findByIdAndUpdate(
				id,
				{
					$set: {
						bookingStatus: AppointmentBookingStatus.Rescheduled,
						...calFields,
						timezone,
						rescheduledFromId: appointment._id,
						lastSyncedAt: new Date(),
					},
				},
				{ session },
			);

			await AppointmentAuditLog.create(
				[
					{
						appointmentId: id,
						userId: user.id,
						action: AuditAction.Rescheduled,
						actor: "user",
						actorId: user.id,
						calBookingId: calFields.calIdBookingId,
						before: { appointmentStart: oldStart },
						after: { appointmentStart: calFields.appointmentStart },
						payload: { reason },
					},
				],
				{ session },
			);
		});

		// Update reminders — cancel old, schedule new
		await cancelReminders(id).catch(() => {});
		if (calFields.appointmentStart) {
			await scheduleReminders(
				new mongoose.Types.ObjectId(id),
				user.id,
				calFields.appointmentStart,
			).catch(() => {});
		}

		notify({
			userId: user.id,
			kind: NotificationKind.AppointmentRescheduled,
			title: "Appointment rescheduled",
			body: "Your appointment has been rescheduled.",
			data: { appointmentId: id },
			channels: [NotificationChannel.InApp, NotificationChannel.Push, NotificationChannel.Socket],
		}).catch(() => {});

		fanOutToAdmin("appointment_created", { appointmentId: id, userId: user.id });

		const updated = await ExpertAppointment.findById(id).lean();
		res.status(200).json({ message: "Appointment rescheduled", appointment: updated });
	} catch (err) {
		if (err instanceof CalIdSlotUnavailableError) {
			res.status(409).json({ error: "Slot no longer available", code: "SLOT_UNAVAILABLE" });
			return;
		}
		if (err instanceof CalIdTimeoutError) {
			res.status(504).json({ error: "Scheduling service timed out", code: "PROVIDER_TIMEOUT" });
			return;
		}
		if (err instanceof CalIdError) {
			res.status(502).json({ error: "Scheduling service error", code: "PROVIDER_ERROR" });
			return;
		}
		next(err);
	}
};

// ─── PATCH /expert-appointments/:id/cancel ────────────────────────────────────

export const cancelAppointment: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "user") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid appointment ID", code: "BAD_REQUEST" });
		return;
	}

	const parsed = cancelAppointmentSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	await cancelAppointmentById(id, user.id, "user", parsed.data.reason, res, next);
};

// ─── PATCH /admin/expert-appointments/:id/cancel ──────────────────────────────

export const adminCancelAppointment: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "admin") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid appointment ID", code: "BAD_REQUEST" });
		return;
	}

	const parsed = cancelAppointmentSchema.safeParse(req.body);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	await cancelAppointmentById(id, user.id, "admin", parsed.data.reason, res, next);
};

// Shared cancel logic
async function cancelAppointmentById(
	id: string,
	actorId: string,
	actor: "user" | "admin",
	reason: string | undefined,
	res: Parameters<RequestHandler>[1],
	next: Parameters<RequestHandler>[2],
): Promise<void> {
	try {
		const appointment = await ExpertAppointment.findById(id);
		if (!appointment) {
			res.status(404).json({ error: "Appointment not found", code: "NOT_FOUND" });
			return;
		}

		// Ownership check for users
		if (actor === "user" && !appointment.userId.equals(actorId)) {
			res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
			return;
		}

		if (!ACTIVE_STATUSES.includes(appointment.bookingStatus as AppointmentBookingStatus)) {
			res.status(409).json({
				error: "Appointment is not in an active state",
				code: "INVALID_STATE",
			});
			return;
		}

		// Cancel in Cal ID if linked
		if (appointment.calIdEventId) {
			try {
				await calidService.cancelBooking(appointment.calIdEventId, reason);
			} catch (err) {
				if (err instanceof CalIdError && err.statusCode === 404) {
					// Already cancelled in Cal ID — proceed with local update
				} else {
					throw err;
				}
			}
		} else if (appointment.calIdBookingId) {
			res.status(409).json({
				error: "Appointment missing numeric Cal ID booking id",
				code: "INVALID_STATE",
			});
			return;
		}

		const now = new Date();

		await withOptionalTransaction(async (session) => {
			await ExpertAppointment.findByIdAndUpdate(
				id,
				{
					$set: {
						bookingStatus: AppointmentBookingStatus.Cancelled,
						cancelledAt: now,
						cancelReason: reason,
						cancelledBy: actorId,
						lastSyncedAt: now,
					},
				},
				{ session },
			);

			await AppointmentAuditLog.create(
				[
					{
						appointmentId: id,
						userId: String(appointment.userId),
						action: AuditAction.Cancelled,
						actor,
						actorId,
						calBookingId: appointment.calIdBookingId,
						payload: { reason },
					},
				],
				{ session },
			);
		});

		// Rewind onboarding step if user hasn't completed onboarding
		await cancelExpertAppointment(
			String(appointment.userId),
			appointment.expertType as ExpertType,
		).catch((err) => console.error("[cancel] cancelExpertAppointment rewind failed", err));

		await cancelReminders(id).catch(() => {});

		notify({
			userId: String(appointment.userId),
			kind: NotificationKind.AppointmentCancelled,
			title: "Appointment cancelled",
			body: "Your appointment has been cancelled.",
			data: { appointmentId: id },
			channels: [NotificationChannel.InApp, NotificationChannel.Push, NotificationChannel.Socket],
		}).catch(() => {});

		fanOutToAdmin("slot_released", { appointmentId: id, userId: String(appointment.userId) });
		emitToFrontDesk("onboarding_progress_changed", {
			userId: String(appointment.userId),
		});

		res.status(200).json({ message: "Appointment cancelled" });
	} catch (err) {
		if (err instanceof CalIdTimeoutError) {
			res.status(504).json({ error: "Scheduling service timed out", code: "PROVIDER_TIMEOUT" });
			return;
		}
		if (err instanceof CalIdError) {
			res.status(502).json({ error: "Scheduling service error", code: "PROVIDER_ERROR" });
			return;
		}
		next(err);
	}
}

// ─── GET /admin/expert-appointments ───────────────────────────────────────────

export const adminListAppointments: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "admin") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const parsed = adminListQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	const { expertType, status, userId, date, page, limit } = parsed.data;

	const filter: Record<string, unknown> = {};
	if (expertType) filter.expertType = expertType;
	if (status) filter.bookingStatus = status;
	if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.userId = userId;
	if (date) {
		const dayStart = new Date(`${date}T00:00:00.000Z`);
		const dayEnd = new Date(`${date}T23:59:59.999Z`);
		filter.appointmentStart = { $gte: dayStart, $lte: dayEnd };
	}

	try {
		const skip = (page - 1) * limit;
		const [appointments, total] = await Promise.all([
			ExpertAppointment.find(filter)
				.sort({ createdAt: -1 })
				.skip(skip)
				.limit(limit)
				.populate("userId", "username email phone")
				.lean(),
			ExpertAppointment.countDocuments(filter),
		]);

		res.status(200).json({
			appointments,
			pagination: { total, page, limit, pages: Math.ceil(total / limit) },
		});
	} catch (err) {
		next(err);
	}
};

// ─── GET /admin/expert-appointments/:id ───────────────────────────────────────

export const adminGetAppointment: RequestHandler = async (req, res, next) => {
	const user = req.user as AuthenticatedUser | undefined;
	if (!user || user.role !== "admin") {
		res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
		return;
	}

	const id = getIdParam(req.params.id);
	if (!id) {
		res.status(400).json({ error: "Invalid appointment ID", code: "BAD_REQUEST" });
		return;
	}

	try {
		const [appointment, auditLogs] = await Promise.all([
			ExpertAppointment.findById(id)
				.populate("userId", "username email phone")
				.lean(),
			AppointmentAuditLog.find({ appointmentId: id })
				.sort({ createdAt: -1 })
				.lean(),
		]);

		if (!appointment) {
			res.status(404).json({ error: "Appointment not found", code: "NOT_FOUND" });
			return;
		}

		res.status(200).json({ appointment, auditLogs });
	} catch (err) {
		next(err);
	}
};
