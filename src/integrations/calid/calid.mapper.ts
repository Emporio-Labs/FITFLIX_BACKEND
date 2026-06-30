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

export function isValidMeetingUrl(url: string | undefined): boolean {
	if (!url) return false;
	if (!/^https?:\/\//i.test(url)) return false;
	if (/jit\.si/i.test(url)) return false;

	if (/meet\.google\.com/i.test(url)) {
		const path = url.replace(/^https?:\/\/(www\.)?meet\.google\.com\/?/i, "");
		if (path.trim().length === 0) return false;
	}

	return true;
}

export function extractMeetingUrl(
	booking: CalIdBookingData,
): string | undefined {
	return booking.meetingUrl ?? booking.location ?? undefined;
}

export function cleanOrFallbackMeetingUrl(
	meetingUrl: string | undefined,
	_booking: CalIdBookingData,
): string | undefined {
	if (isValidMeetingUrl(meetingUrl)) {
		return meetingUrl;
	}
	return undefined;
}

export function mapCalBookingToAppointmentFields(booking: CalIdBookingData): {
	calIdBookingId: string;
	calIdEventId: string;
	calIdEventTypeId: string;
	meetingUrl: string | undefined;
	meetingLink: string | undefined;
	appointmentStart: Date;
	appointmentEnd: Date;
} {
	const start = booking.startTime || booking.start || "";
	const end = booking.endTime || booking.end || "";
	const rawUrl = extractMeetingUrl(booking);
	const cleanUrl = cleanOrFallbackMeetingUrl(rawUrl, booking);
	return {
		calIdBookingId: booking.uid,
		calIdEventId: String(booking.id),
		calIdEventTypeId: String(booking.eventTypeId),
		meetingUrl: cleanUrl,
		meetingLink: cleanUrl,
		appointmentStart: new Date(start),
		appointmentEnd: new Date(end),
	};
}
