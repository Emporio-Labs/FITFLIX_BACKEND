import AvailabilityCache from "../../models/AvailabilityCache";
import { ExpertType } from "../../models/Enums";
import * as client from "./calcom.client";
import { eventTypeIdForExpert, mapCalBookingToAppointmentFields } from "./calcom.mapper";
import type {
	CalcomBookingData,
	CalcomSlotUnavailableError,
	SlotsByDay,
} from "./calcom.types";
import { groupSlotsByDay, toEndOfDayUTC, toStartOfDayUTC } from "./calcom.utils";

const CACHE_TTL_SECONDS = 60;

// ─── Availability ─────────────────────────────────────────────────────────────

export async function fetchAvailability(
	expertType: ExpertType,
	startDate: string, // YYYY-MM-DD
	endDate: string, // YYYY-MM-DD
	timezone: string,
): Promise<SlotsByDay[]> {
	const eventTypeId = eventTypeIdForExpert(expertType);

	// Try cache first — aggregate all cached days in range
	const now = new Date();
	const cached = await AvailabilityCache.find({
		expertType,
		eventTypeId,
		timezone,
		dateKey: { $gte: startDate, $lte: endDate },
		expiresAt: { $gt: now },
	}).lean();

	// Build a map of cached dateKeys
	const cachedMap = new Map<string, { start: string; end: string }[]>(
		cached.map((c) => [c.dateKey, c.slots]),
	);

	// Fetch missing days from Cal.com
	const current = new Date(`${startDate}T00:00:00.000Z`);
	const end = new Date(`${endDate}T23:59:59.999Z`);
	const missingDates: string[] = [];

	while (current <= end) {
		const dk = current.toISOString().slice(0, 10);
		if (!cachedMap.has(dk)) missingDates.push(dk);
		current.setUTCDate(current.getUTCDate() + 1);
	}

	if (missingDates.length > 0) {
		const freshResponse = await client.getSlots({
			eventTypeId,
			startTime: toStartOfDayUTC(missingDates[0]!),
			endTime: toEndOfDayUTC(missingDates[missingDates.length - 1]!),
			timeZone: timezone,
		});

		const fresh = freshResponse.data.slots ?? {};
		const freshDays = groupSlotsByDay(fresh);

		// Upsert fresh days into cache
		const cacheOps = missingDates.map((dk) => {
			const day = freshDays.find((d) => d.date === dk);
			const slots = day?.slots ?? [];
			const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
			const fetchedAt = new Date();

			return AvailabilityCache.findOneAndUpdate(
				{ expertType, eventTypeId, dateKey: dk, timezone },
				{ expertType, eventTypeId, dateKey: dk, timezone, slots, fetchedAt, expiresAt },
				{ upsert: true, new: true },
			);
		});

		await Promise.allSettled(cacheOps);

		// Merge fresh into cachedMap
		for (const day of freshDays) {
			cachedMap.set(day.date, day.slots);
		}

		// Ensure missing dates with zero slots are recorded
		for (const dk of missingDates) {
			if (!cachedMap.has(dk)) cachedMap.set(dk, []);
		}
	}

	// Build ordered response
	const allDays: SlotsByDay[] = [];
	const iter = new Date(`${startDate}T00:00:00.000Z`);
	const iterEnd = new Date(`${endDate}T23:59:59.999Z`);

	while (iter <= iterEnd) {
		const dk = iter.toISOString().slice(0, 10);
		const slots = cachedMap.get(dk) ?? [];
		if (slots.length > 0) allDays.push({ date: dk, slots });
		iter.setUTCDate(iter.getUTCDate() + 1);
	}

	return allDays;
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export async function createBooking(params: {
	expertType: ExpertType;
	slotStart: string; // ISO 8601
	timezone: string;
	attendee: { name: string; email: string };
	userId: string;
}): Promise<CalcomBookingData> {
	const eventTypeId = eventTypeIdForExpert(params.expertType);

	const response = await client.createBooking({
		eventTypeId,
		start: params.slotStart,
		attendee: {
			name: params.attendee.name,
			email: params.attendee.email,
			timeZone: params.timezone,
		},
		metadata: { userId: params.userId },
		language: "en",
	});

	// Invalidate availability cache for the booked date
	const bookedDate = new Date(params.slotStart).toISOString().slice(0, 10);
	await AvailabilityCache.deleteOne({
		expertType: params.expertType,
		dateKey: bookedDate,
		timezone: params.timezone,
	}).catch(() => {
		// Non-fatal — stale cache will expire naturally
	});

	return response.data;
}

// ─── Reschedule ───────────────────────────────────────────────────────────────

export async function rescheduleBooking(
	calBookingUid: string,
	newSlotStart: string,
	timezone: string,
	reason?: string,
): Promise<CalcomBookingData> {
	const response = await client.rescheduleBooking(calBookingUid, {
		start: newSlotStart,
		rescheduledReason: reason,
	});

	// Invalidate cache for the new date
	const newDate = new Date(newSlotStart).toISOString().slice(0, 10);
	await AvailabilityCache.deleteMany({ dateKey: newDate }).catch(() => {});

	return response.data;
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelBooking(
	calBookingUid: string,
	reason?: string,
): Promise<void> {
	await client.cancelBooking(calBookingUid, {
		cancellationReason: reason,
	});
}

// ─── Fetch single booking (for reconciliation) ────────────────────────────────

export async function getBooking(uid: string): Promise<CalcomBookingData> {
	const response = await client.getBooking(uid);
	return response.data;
}

// ─── Re-export error types so callers don't need to import calcom.types ───────
export type { CalcomBookingData, SlotsByDay, CalcomSlotUnavailableError };
export { mapCalBookingToAppointmentFields };
