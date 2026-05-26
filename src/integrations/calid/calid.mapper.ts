import { ExpertType } from "../../models/Enums";
import type { CalIdBookingData } from "./calid.types";

export function expertTypeFromEventTypeId(
	eventTypeId: string | number,
): ExpertType | null {
	const id = String(eventTypeId);
	const ssId = process.env.CALID_EVENT_TYPE_SPORTS_SCIENTIST;
	const nuId = process.env.CALID_EVENT_TYPE_NUTRITIONIST;

	if (ssId && id === ssId) return ExpertType.SportsScientist;
	if (nuId && id === nuId) return ExpertType.Nutritionist;

	return null;
}

export function eventTypeIdForExpert(expertType: ExpertType): string {
	const ssId = process.env.CALID_EVENT_TYPE_SPORTS_SCIENTIST;
	const nuId = process.env.CALID_EVENT_TYPE_NUTRITIONIST;

	if (expertType === ExpertType.SportsScientist) {
		if (!ssId) throw new Error("CALID_EVENT_TYPE_SPORTS_SCIENTIST is not set");
		return ssId;
	}

	if (!nuId) throw new Error("CALID_EVENT_TYPE_NUTRITIONIST is not set");
	return nuId;
}

export function extractMeetingUrl(booking: CalIdBookingData): string | undefined {
	return booking.meetingUrl ?? booking.location ?? undefined;
}

export function mapCalBookingToAppointmentFields(booking: CalIdBookingData): {
	calIdBookingId: string;
	calIdEventId: string;
	calIdEventTypeId: string;
	meetingUrl: string | undefined;
	appointmentStart: Date;
	appointmentEnd: Date;
} {
	const start = booking.startTime || booking.start || "";
	const end = booking.endTime || booking.end || "";
	return {
		calIdBookingId: booking.uid,
		calIdEventId: String(booking.id),
		calIdEventTypeId: String(booking.eventTypeId),
		meetingUrl: extractMeetingUrl(booking),
		appointmentStart: new Date(start),
		appointmentEnd: new Date(end),
	};
}
