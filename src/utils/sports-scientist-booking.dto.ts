import type mongoose from "mongoose";
import {
	AppointmentBookingStatus,
	ServiceCategory,
	ServiceSubtype,
	UnifiedBookingStatus,
} from "../models/Enums";

/**
 * 1:1 sports-scientist consultations moved from their own `ExpertAppointment`
 * collection into `UnifiedBooking`, mirroring the nutritionist migration (see
 * `nutritionist-booking.dto.ts`). Storage changed; the wire format did not.
 *
 * The member app and the front desk both read `bookingStatus` in the
 * `AppointmentBookingStatus` vocabulary and both read `assignedExpertId` /
 * `clinicLocation` / `notes` by those names. Translating here keeps the risky
 * half of the migration entirely inside the backend — no client has to ship in
 * lockstep with it.
 *
 * The only asymmetry worth remembering: `Confirmed` and `CONFIRMED` are the
 * same state. Everything else maps one-to-one. `Expired` and
 * `RescheduleRequired` were added to `AppointmentBookingStatus` for this
 * migration — they didn't exist before because `ExpertAppointment` had no
 * expiry sweep of its own.
 */

/** Base filter selecting exactly the sports-scientist consultations. */
export const SPORTS_SCIENTIST_BOOKING_FILTER = {
	serviceCategory: ServiceCategory.EXPERT_SESSION,
	serviceSubtype: ServiceSubtype.SPORTS_SCIENTIST,
} as const;

const STATUS_TO_LEGACY: Record<string, AppointmentBookingStatus> = {
	[UnifiedBookingStatus.PENDING]: AppointmentBookingStatus.Pending,
	[UnifiedBookingStatus.CONFIRMED]: AppointmentBookingStatus.Confirmed,
	[UnifiedBookingStatus.REJECTED]: AppointmentBookingStatus.Rejected,
	[UnifiedBookingStatus.CANCELLED]: AppointmentBookingStatus.Cancelled,
	[UnifiedBookingStatus.COMPLETED]: AppointmentBookingStatus.Completed,
	[UnifiedBookingStatus.EXPIRED]: AppointmentBookingStatus.Expired,
	[UnifiedBookingStatus.RESCHEDULE_REQUIRED]:
		AppointmentBookingStatus.RescheduleRequired,
	// A host no-show never happened from the member's point of view; it reads
	// as an appointment that lapsed — mirrors nutritionist-booking.dto.ts
	// exactly. Deliberately NOT `AppointmentBookingStatus.NoShow`: that legacy
	// value predates UnifiedBooking, was never written by any code path, and
	// its name is ambiguous with the opposite case (a member no-show) — not
	// worth resurrecting for a status nothing produces.
	[UnifiedBookingStatus.HOST_NO_SHOW]: AppointmentBookingStatus.Expired,
};

const LEGACY_TO_STATUS: Record<string, UnifiedBookingStatus> = {
	[AppointmentBookingStatus.Pending]: UnifiedBookingStatus.PENDING,
	[AppointmentBookingStatus.Confirmed]: UnifiedBookingStatus.CONFIRMED,
	[AppointmentBookingStatus.Rejected]: UnifiedBookingStatus.REJECTED,
	[AppointmentBookingStatus.Cancelled]: UnifiedBookingStatus.CANCELLED,
	[AppointmentBookingStatus.Completed]: UnifiedBookingStatus.COMPLETED,
	[AppointmentBookingStatus.Expired]: UnifiedBookingStatus.EXPIRED,
	[AppointmentBookingStatus.RescheduleRequired]:
		UnifiedBookingStatus.RESCHEDULE_REQUIRED,
	[AppointmentBookingStatus.NoShow]: UnifiedBookingStatus.HOST_NO_SHOW,
};

export const toLegacySportsScientistStatus = (
	status: string | null | undefined,
): AppointmentBookingStatus =>
	STATUS_TO_LEGACY[String(status)] ?? AppointmentBookingStatus.Pending;

/**
 * Case-sensitive on purpose: unlike `NutritionistBookingStatus`
 * (SCREAMING_CASE), `AppointmentBookingStatus` values are PascalCase, so
 * there is no case-vocabulary mismatch to normalise away here.
 */
export const fromLegacySportsScientistStatus = (
	status: string | null | undefined,
): UnifiedBookingStatus | null =>
	LEGACY_TO_STATUS[String(status)] ?? null;

/** Statuses a member may still act on (rebook via "choose another time"). */
export const ACTIVE_SPORTS_SCIENTIST_STATUSES = [
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
 * The legacy `ExpertAppointment` wire shape. `userId` and `expertId` are
 * passed through as-is so a `.populate()` on either still serialises the
 * populated document rather than a bare id. Deliberately has no
 * `meetingLink` — the room is now `zegoRoomId`, resolved through the Zego
 * token endpoint the same way the nutritionist consult already is.
 */
export const serializeSportsScientistBooking = (booking: BookingLike) => ({
	_id: String(booking._id),
	id: String(booking._id),
	userId: booking.userId ?? null,
	slotId: booking.slotId ?? null,
	appointmentDate: booking.bookingDate ?? null,
	startTime: booking.startTime ?? null,
	endTime: booking.endTime ?? null,
	appointmentMode: booking.appointmentMode ?? null,
	clinicLocation: booking.location ?? null,
	locationId: booking.locationId ?? null,
	zegoRoomId: booking.zegoRoomId ?? null,
	assignedExpertId: booking.expertId ?? null,
	assignedExpertName: booking.assignedExpertName || null,
	meetingStatus: booking.meetingStatus ?? null,
	bookingStatus: toLegacySportsScientistStatus(booking.status),
	notes: booking.memberNotes ?? null,
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
