import { ExpertType } from "../../models/Enums";
import type { CalcomBookingData } from "./calcom.types";

/** Resolves ExpertType from a Cal.com eventTypeId string */
export function expertTypeFromEventTypeId(
	eventTypeId: string | number,
): ExpertType | null {
	const id = String(eventTypeId);
	const ssId = process.env.CAL_EVENT_TYPE_SPORTS_SCIENTIST;
	const nuId = process.env.CAL_EVENT_TYPE_NUTRITIONIST;

	if (ssId && id === ssId) return ExpertType.SportsScientist;
	if (nuId && id === nuId) return ExpertType.Nutritionist;

	return null;
}

/** Returns the Cal.com eventTypeId for a given ExpertType */
export function eventTypeIdForExpert(expertType: ExpertType): string {
	const ssId = process.env.CAL_EVENT_TYPE_SPORTS_SCIENTIST;
	const nuId = process.env.CAL_EVENT_TYPE_NUTRITIONIST;

	if (expertType === ExpertType.SportsScientist) {
		if (!ssId) throw new Error("CAL_EVENT_TYPE_SPORTS_SCIENTIST is not set");
		return ssId;
	}

	if (!nuId) throw new Error("CAL_EVENT_TYPE_NUTRITIONIST is not set");
	return nuId;
}

/** Picks the best meeting URL from a Cal.com booking */
export function extractMeetingUrl(booking: CalcomBookingData): string | undefined {
	return booking.meetingUrl ?? booking.location ?? undefined;
}

/** Maps a Cal.com booking to the fields we store on ExpertAppointment */
export function mapCalBookingToAppointmentFields(booking: CalcomBookingData): {
	calComBookingId: string;
	calEventId: string;
	calEventTypeId: string;
	meetingUrl: string | undefined;
	appointmentStart: Date;
	appointmentEnd: Date;
} {
	return {
		calComBookingId: booking.uid,
		calEventId: String(booking.id),
		calEventTypeId: String(booking.eventTypeId),
		meetingUrl: extractMeetingUrl(booking),
		appointmentStart: new Date(booking.start),
		appointmentEnd: new Date(booking.end),
	};
}
