import type mongoose from "mongoose";
import {
	NutritionistBookingStatus,
	ServiceCategory,
	ServiceSubtype,
	UnifiedBookingStatus,
} from "../models/Enums";

/**
 * 1:1 nutrition consultations moved from their own `NutritionistBooking`
 * collection into `UnifiedBooking`. Storage changed; the wire format did not.
 *
 * The member app and the front desk both read `status` in the
 * `NutritionistBookingStatus` vocabulary and both read `assignedNutritionistId`
 * / `clinicLocation` / `notes` by those names. Translating here keeps the risky
 * half of the migration entirely inside the backend — no client has to ship in
 * lockstep with it.
 *
 * The only asymmetry worth remembering: `ACCEPTED` and `CONFIRMED` are the same
 * state. Everything else maps one-to-one, `REJECTED` included, which is why it
 * had to be added to `UnifiedBookingStatus` rather than folded into
 * `CANCELLED` — `getOnboardingStatus` and `completeOnboarding` both branch on
 * "a non-REJECTED booking exists".
 */

/** Base filter selecting exactly the nutrition consultations. */
export const NUTRITIONIST_BOOKING_FILTER = {
	serviceCategory: ServiceCategory.EXPERT_SESSION,
	serviceSubtype: ServiceSubtype.NUTRITIONIST,
} as const;

const STATUS_TO_LEGACY: Record<string, NutritionistBookingStatus> = {
	[UnifiedBookingStatus.PENDING]: NutritionistBookingStatus.PENDING,
	[UnifiedBookingStatus.CONFIRMED]: NutritionistBookingStatus.ACCEPTED,
	[UnifiedBookingStatus.REJECTED]: NutritionistBookingStatus.REJECTED,
	[UnifiedBookingStatus.CANCELLED]: NutritionistBookingStatus.CANCELLED,
	[UnifiedBookingStatus.COMPLETED]: NutritionistBookingStatus.COMPLETED,
	[UnifiedBookingStatus.EXPIRED]: NutritionistBookingStatus.EXPIRED,
	[UnifiedBookingStatus.RESCHEDULE_REQUIRED]:
		NutritionistBookingStatus.RESCHEDULE_REQUIRED,
	// A host no-show never happened from the member's point of view; it reads
	// as an appointment that lapsed.
	[UnifiedBookingStatus.HOST_NO_SHOW]: NutritionistBookingStatus.EXPIRED,
};

const LEGACY_TO_STATUS: Record<string, UnifiedBookingStatus> = {
	[NutritionistBookingStatus.PENDING]: UnifiedBookingStatus.PENDING,
	[NutritionistBookingStatus.ACCEPTED]: UnifiedBookingStatus.CONFIRMED,
	[NutritionistBookingStatus.REJECTED]: UnifiedBookingStatus.REJECTED,
	[NutritionistBookingStatus.CANCELLED]: UnifiedBookingStatus.CANCELLED,
	[NutritionistBookingStatus.COMPLETED]: UnifiedBookingStatus.COMPLETED,
	[NutritionistBookingStatus.EXPIRED]: UnifiedBookingStatus.EXPIRED,
	[NutritionistBookingStatus.RESCHEDULE_REQUIRED]:
		UnifiedBookingStatus.RESCHEDULE_REQUIRED,
};

export const toLegacyNutritionistStatus = (
	status: string | null | undefined,
): NutritionistBookingStatus =>
	STATUS_TO_LEGACY[String(status)] ?? NutritionistBookingStatus.PENDING;

export const fromLegacyNutritionistStatus = (
	status: string | null | undefined,
): UnifiedBookingStatus | null =>
	LEGACY_TO_STATUS[String(status).toUpperCase()] ?? null;

/** Statuses a member may still act on (cancel / reschedule). */
export const ACTIVE_NUTRITIONIST_STATUSES = [
	UnifiedBookingStatus.PENDING,
	UnifiedBookingStatus.CONFIRMED,
	UnifiedBookingStatus.RESCHEDULE_REQUIRED,
];

type BookingLike = {
	_id: mongoose.Types.ObjectId | string;
	userId?: unknown;
	slotId?: mongoose.Types.ObjectId | null;
	bookingDate?: Date | null;
	startTime?: string | null;
	endTime?: string | null;
	appointmentMode?: string | null;
	location?: string | null;
	locationId?: mongoose.Types.ObjectId | null;
	zegoRoomId?: string | null;
	expertId?: unknown;
	assignedExpertName?: string | null;
	meetingStatus?: string | null;
	status?: string | null;
	memberNotes?: string | null;
	sessionNotes?: { dietaryAdvice?: string | null } | null;
	acceptedAt?: Date | null;
	completedAt?: Date | null;
	cancelledAt?: Date | null;
	cancelledBy?: string | null;
	cancellationReason?: string | null;
	rejectedAt?: Date | null;
	rejectionReason?: string | null;
	createdAt?: Date | null;
	updatedAt?: Date | null;
};

/**
 * The legacy `NutritionistBooking` wire shape. `userId` and `expertId` are
 * passed through as-is so a `.populate()` on either still serialises the
 * populated document rather than a bare id.
 */
export const serializeNutritionistBooking = (booking: BookingLike) => ({
	_id: String(booking._id),
	id: String(booking._id),
	userId: booking.userId ?? null,
	slotId: booking.slotId ?? null,
	bookingDate: booking.bookingDate ?? null,
	startTime: booking.startTime ?? null,
	endTime: booking.endTime ?? null,
	appointmentMode: booking.appointmentMode ?? null,
	clinicLocation: booking.location ?? null,
	locationId: booking.locationId ?? null,
	zegoRoomId: booking.zegoRoomId ?? null,
	assignedNutritionistId: booking.expertId ?? null,
	assignedNutritionistName: booking.assignedExpertName || null,
	meetingStatus: booking.meetingStatus ?? null,
	status: toLegacyNutritionistStatus(booking.status),
	notes: booking.memberNotes ?? null,
	dietaryAdvice: booking.sessionNotes?.dietaryAdvice || null,
	acceptedAt: booking.acceptedAt ?? null,
	completedAt: booking.completedAt ?? null,
	cancelledAt: booking.cancelledAt ?? null,
	cancelledBy: booking.cancelledBy ?? null,
	cancellationReason: booking.cancellationReason ?? null,
	rejectedAt: booking.rejectedAt ?? null,
	rejectionReason: booking.rejectionReason ?? null,
	createdAt: booking.createdAt ?? null,
	updatedAt: booking.updatedAt ?? null,
});
