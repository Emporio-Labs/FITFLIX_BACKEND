import AvailabilityCache from "../../models/AvailabilityCache";
import { ExpertType } from "../../models/Enums";
import * as client from "./calid.client";
import { eventTypeIdForExpert, mapCalBookingToAppointmentFields } from "./calid.mapper";
import type {
	CalIdBookingData,
	CalIdEventType,
	CalIdSchedule,
	CalIdScheduleAvailability,
	CalIdSlotUnavailableError,
	NormalizedSlot,
	SlotsByDay,
} from "./calid.types";
import { groupSlotsByDay } from "./calid.utils";

const CACHE_TTL_SECONDS = 60;
const DEFAULT_SLOT_LENGTH_MIN = 60;

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

	const cachedMap = new Map<string, { start: string; end: string }[]>(
		cached.map((c) => [c.dateKey, c.slots]),
	);

	// Identify missing days
	const current = new Date(`${startDate}T00:00:00.000Z`);
	const end = new Date(`${endDate}T23:59:59.999Z`);
	const missingDates: string[] = [];

	while (current <= end) {
		const dk = current.toISOString().slice(0, 10);
		if (!cachedMap.has(dk)) missingDates.push(dk);
		current.setUTCDate(current.getUTCDate() + 1);
	}

	if (missingDates.length > 0) {
		const freshDays = await deriveAvailableSlots(
			eventTypeId,
			missingDates,
			timezone,
		);

		// Upsert fresh days into cache (record empty days too — prevents re-fetch storms)
		const freshDayMap = new Map(freshDays.map((d) => [d.date, d.slots]));
		const cacheOps = missingDates.map((dk) => {
			const slots = freshDayMap.get(dk) ?? [];
			const expiresAt = new Date(Date.now() + CACHE_TTL_SECONDS * 1000);
			const fetchedAt = new Date();

			return AvailabilityCache.findOneAndUpdate(
				{ expertType, eventTypeId, dateKey: dk, timezone },
				{ expertType, eventTypeId, dateKey: dk, timezone, slots, fetchedAt, expiresAt },
				{ upsert: true, new: true },
			);
		});

		await Promise.allSettled(cacheOps);

		for (const [date, slots] of freshDayMap) {
			cachedMap.set(date, slots);
		}
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

// ─── Local slot derivation ────────────────────────────────────────────────────
//
// Cal ID does not expose a /slots endpoint. We reconstruct availability from:
//   1. /event-types/{id} — slot length + minimum notice + scheduleId
//   2. /schedule/{scheduleId} (or /schedule/) — weekly working windows
//   3. /booking/?eventTypeId=...&afterStart=...&beforeEnd=... — booked times
// then we walk the date range generating candidate starts at slotInterval,
// filtering by working hours, minimumBookingNotice, and existing bookings.

async function deriveAvailableSlots(
	eventTypeId: string,
	dateKeys: string[],
	_timezone: string,
): Promise<SlotsByDay[]> {
	if (dateKeys.length === 0) return [];

	const sortedDates = [...dateKeys].sort();
	const startDate = sortedDates[0]!;
	const endDate = sortedDates[sortedDates.length - 1]!;

	const eventType = await fetchEventType(eventTypeId);
	const schedule = await fetchSchedule(eventType.scheduleId ?? null);

	const slotLengthMin =
		typeof eventType.length === "number" && eventType.length > 0
			? eventType.length
			: DEFAULT_SLOT_LENGTH_MIN;
	const slotIntervalMin =
		typeof eventType.slotInterval === "number" && eventType.slotInterval > 0
			? eventType.slotInterval
			: slotLengthMin;
	const minimumBookingNoticeMin =
		typeof eventType.minimumBookingNotice === "number"
			? eventType.minimumBookingNotice
			: 0;

	const bookedRanges = await fetchBookedRanges(
		eventTypeId,
		`${startDate}T00:00:00.000Z`,
		`${endDate}T23:59:59.999Z`,
	);

	const noticeCutoff = new Date(Date.now() + minimumBookingNoticeMin * 60_000);

	const slots: NormalizedSlot[] = [];

	for (const dateKey of sortedDates) {
		const dayWindows = windowsForDate(schedule, dateKey);
		for (const win of dayWindows) {
			let cursorMs = win.startMs;
			while (cursorMs + slotLengthMin * 60_000 <= win.endMs) {
				const startMs = cursorMs;
				const endMs = cursorMs + slotLengthMin * 60_000;

				if (startMs >= noticeCutoff.getTime() && !overlapsBooked(startMs, endMs, bookedRanges)) {
					slots.push({
						start: new Date(startMs).toISOString(),
						end: new Date(endMs).toISOString(),
					});
				}

				cursorMs += slotIntervalMin * 60_000;
			}
		}
	}

	return groupSlotsByDay(slots);
}

async function fetchEventType(eventTypeId: string): Promise<CalIdEventType> {
	const resp = await client.getEventType(eventTypeId);
	const data = resp.data;
	if (!data || typeof data.id !== "number") {
		throw new Error(`Cal ID returned no event type for id=${eventTypeId}`);
	}
	return data;
}

async function fetchSchedule(scheduleId: number | null): Promise<CalIdSchedule | null> {
	try {
		if (scheduleId !== null && scheduleId !== undefined) {
			const resp = await client.getSchedule(scheduleId);
			if (resp.data) return resp.data;
		}

		// Fall back to first schedule in the account
		const list = await client.listSchedules();
		const data = list.data;
		if (Array.isArray(data) && data.length > 0) return data[0]!;
		if (data && !Array.isArray(data)) return data;
		return null;
	} catch (err) {
		console.warn("[calid] schedule fetch failed; assuming 09:00-17:00 Mon-Fri", err);
		return null;
	}
}

async function fetchBookedRanges(
	eventTypeId: string,
	afterStart: string,
	beforeEnd: string,
): Promise<Array<{ startMs: number; endMs: number }>> {
	try {
		const resp = await client.listBookings({
			eventTypeId,
			afterStart,
			beforeEnd,
			status: "upcoming",
		});
		const list = Array.isArray(resp.data) ? resp.data : [];
		return list
			.filter((b) => (b?.start || b?.startTime) && (b?.end || b?.endTime))
			.map((b) => ({
				startMs: new Date(b.start || b.startTime || "").getTime(),
				endMs: new Date(b.end || b.endTime || "").getTime(),
			}))
			.filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs));
	} catch (err) {
		console.warn("[calid] booked-ranges fetch failed; treating window as fully open", err);
		return [];
	}
}

interface DayWindow {
	startMs: number;
	endMs: number;
}

const DEFAULT_WEEKLY_WINDOWS: CalIdScheduleAvailability[] = [
	{ days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" },
];

function windowsForDate(
	schedule: CalIdSchedule | null,
	dateKey: string, // YYYY-MM-DD (UTC)
): DayWindow[] {
	const baseDay = new Date(`${dateKey}T00:00:00.000Z`);
	const weekday = baseDay.getUTCDay(); // 0..6

	const availability =
		schedule?.availability && schedule.availability.length > 0
			? schedule.availability
			: DEFAULT_WEEKLY_WINDOWS;

	const dateOverrides = availability.filter((a) => a.date === dateKey);
	const candidates = dateOverrides.length > 0
		? dateOverrides
		: availability.filter((a) => !a.date && Array.isArray(a.days) && a.days.includes(weekday));

	const windows: DayWindow[] = [];
	for (const c of candidates) {
		const start = parseTimeOnDate(dateKey, c.startTime);
		const end = parseTimeOnDate(dateKey, c.endTime);
		if (start !== null && end !== null && end > start) {
			windows.push({ startMs: start, endMs: end });
		}
	}
	return windows;
}

function parseTimeOnDate(dateKey: string, timeStr: string): number | null {
	// Format 1: ISO timestamp (e.g. "1970-01-01T09:00:00.000Z")
	if (timeStr.includes("T")) {
		try {
			const d = new Date(timeStr);
			if (!Number.isNaN(d.getTime())) {
				const hour = d.getUTCHours();
				const minute = d.getUTCMinutes();
				const pad = (n: number) => String(n).padStart(2, "0");
				return new Date(`${dateKey}T${pad(hour)}:${pad(minute)}:00.000Z`).getTime();
			}
		} catch (_) {}
	}

	// Format 2: Raw "HH:mm" string
	const m = /^(\d{2}):(\d{2})$/.exec(timeStr);
	if (!m) return null;
	const hour = Number(m[1]);
	const minute = Number(m[2]);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
	// Interpreting schedule HH:mm as UTC. If the schedule timezone differs, the
	// downstream UI display still uses the user-provided timezone; bookings carry
	// their own UTC start so this remains consistent.
	return new Date(`${dateKey}T${timeStr}:00.000Z`).getTime();
}

function overlapsBooked(
	startMs: number,
	endMs: number,
	booked: Array<{ startMs: number; endMs: number }>,
): boolean {
	for (const b of booked) {
		if (startMs < b.endMs && endMs > b.startMs) return true;
	}
	return false;
}

// ─── Booking ──────────────────────────────────────────────────────────────────

export async function createBooking(params: {
	expertType: ExpertType;
	slotStart: string; // ISO 8601
	timezone: string;
	attendee: { name: string; email: string };
	userId: string;
}): Promise<CalIdBookingData> {
	const eventTypeId = eventTypeIdForExpert(params.expertType);

	const envVarName =
		params.expertType === ExpertType.SportsScientist
			? "CALID_EVENT_TYPE_SPORTS_SCIENTIST"
			: "CALID_EVENT_TYPE_NUTRITIONIST";
	console.log(
		`[CALID SVC] expertType=${params.expertType} envVar=${envVarName} envValue=${process.env[envVarName]} resolved=${eventTypeId} finalNumber=${Number(eventTypeId)}`,
	);

	// Fetch event type to read slot duration length
	const eventType = await fetchEventType(eventTypeId);
	const length = eventType.length ?? DEFAULT_SLOT_LENGTH_MIN;

	// Attempt to preserve exact provider slot object from availability cache
	// If available, use its `start`/`end` and the cache `timezone` (provider context)
	let providerSlot: { start: string; end?: string; fetchedAt?: string } | null = null;
	let providerTimezone: string | undefined = undefined;
	try {
		const bookedDate = new Date(params.slotStart).toISOString().slice(0, 10);
		const cached = await AvailabilityCache.findOne({
			expertType: params.expertType,
			eventTypeId,
			dateKey: bookedDate,
			timezone: params.timezone,
		}).lean();
		if (cached && Array.isArray(cached.slots)) {
			const match = cached.slots.find((s) => s.start === params.slotStart);
			if (match) {
				providerSlot = { start: match.start, end: match.end };
				if (cached.fetchedAt) providerSlot.fetchedAt = new Date(cached.fetchedAt).toISOString();
				providerTimezone = cached.timezone;
			}
		}
	} catch (err) {
		console.warn("[CALID SVC] availability cache lookup failed", err);
	}

	// Determine slot end: prefer provider slot end when available
	const slotEnd = providerSlot && providerSlot.end
		? providerSlot.end
		: new Date(new Date(params.slotStart).getTime() + length * 60_000).toISOString();

	const currentUtcTime = new Date().toISOString();
	console.log(`\n  ┌──────────────────────────────────────────────────────────────────────────────┐`);
	console.log(`  │ 🔍 CAL ID Downstream Booking Dispatch Diagnostics                             │`);
	console.log(`  ├──────────────────────────────────────────────────────────────────────────────┤`);
	console.log(`  │ Current UTC Time     : ${currentUtcTime.padEnd(52)} │`);
	console.log(`  │ Fetched Slot Start   : ${params.slotStart.padEnd(52)} │`);
	console.log(`  │ Provider Slot End    : ${(providerSlot && providerSlot.end) ? providerSlot.end : "<none>"}
`.padEnd(52) + ` │`);
	console.log(`  │ Generated Slot End   : ${slotEnd.padEnd(52)} │`);
	console.log(`  │ Provider Timezone    : ${(providerTimezone ?? "<none>").padEnd(52)} │`);
	console.log(`  │ Event Duration       : ${(length + " minutes").padEnd(52)} │`);
	console.log(`  │ Timezone Context     : ${params.timezone.padEnd(52)} │`);
	console.log(`  │ Event Type ID        : ${eventTypeId.padEnd(52)} │`);
	console.log(`  ├──────────────────────────────────────────────────────────────────────────────┤`);
	console.log(`  │ Payload Sent:                                                                │`);
	const finalTimezone = providerTimezone ?? params.timezone;

	const payload = {
		eventTypeId: Number(eventTypeId),
		start: params.slotStart,
		end: slotEnd,
		responses: {
			name: params.attendee.name,
			email: params.attendee.email,
		},
		attendee: {
			name: params.attendee.name,
			email: params.attendee.email,
			timeZone: finalTimezone,
			language: "en",
		},
		metadata: { userId: params.userId },
	};

	const payloadLog = JSON.stringify(payload, null, 2).split("\n");
	for (const line of payloadLog) {
		console.log(`  │   ${line.padEnd(74)} │`);
	}
	console.log(`  └──────────────────────────────────────────────────────────────────────────────┘\n`);

	// Additional debug: schedule windows for the date (provider schedule context)
	try {
		const schedule = await fetchSchedule(eventType.scheduleId ?? null);
		const bookedDate = new Date(params.slotStart).toISOString().slice(0, 10);
		const scheduleWindows = windowsForDate(schedule, bookedDate).map((w) => ({
			start: new Date(w.startMs).toISOString(),
			end: new Date(w.endMs).toISOString(),
		}));
		console.log(`  │ Schedule windows for ${bookedDate}: ${JSON.stringify(scheduleWindows)}\n`);
	} catch (err) {
		console.warn("[CALID SVC] schedule fetch for diagnostics failed", err);
	}

	// Extra diagnostics: timezone conversion and delay since availability fetch
	try {
		const utcStart = new Date(params.slotStart).toISOString();
		const localStart = new Date(params.slotStart).toString();
		console.log(`  │ UTC Start            : ${utcStart.padEnd(52)} │`);
		console.log(`  │ Local Start          : ${localStart.padEnd(52)} │`);
		if (providerSlot && providerSlot.fetchedAt) {
			const fetchedMs = new Date(providerSlot.fetchedAt).getTime();
			const delayMs = Date.now() - fetchedMs;
			console.log(`  │ Slot fetchedAt       : ${providerSlot.fetchedAt.padEnd(52)} │`);
			console.log(`  │ Delay fetch->book ms : ${String(delayMs).padEnd(52)} │`);
		} else {
			console.log(`  │ Slot fetchedAt       : ${"<unknown>".padEnd(52)} │`);
		}
	} catch (err) {
		console.warn("[CALID SVC] diagnostic timezone/logging failed", err);
	}

	const response = await client.createBooking(payload);

	const bookedDate = new Date(params.slotStart).toISOString().slice(0, 10);
	await AvailabilityCache.deleteOne({
		expertType: params.expertType,
		dateKey: bookedDate,
		timezone: params.timezone,
	}).catch(() => {});

	return response.data;
}

// ─── Reschedule ───────────────────────────────────────────────────────────────

export async function rescheduleBooking(params: {
	calBookingId: string | number;
	calBookingUid?: string;
	calEventTypeId?: string | number;
	newSlotStart: string;
	timezone: string;
	reason?: string;
	rescheduledBy?: string;
}): Promise<CalIdBookingData> {
	const booking = await getBooking(String(params.calBookingId));
	const payload = {
		start: params.newSlotStart,
		...(params.rescheduledBy ? { rescheduledBy: params.rescheduledBy } : {}),
		...(params.reason ? { reschedulingReason: params.reason } : {}),
	};

	console.log(
		`[CALID SVC RESCHEDULE] bookingUid=${params.calBookingUid ?? booking.uid ?? "<unknown>"} bookingId=${params.calBookingId} endpoint=PATCH /booking/${String(params.calBookingId)}/reschedule timezone=${params.timezone} payload=${JSON.stringify(payload)}`,
	);

	const response = await client.rescheduleBooking(params.calBookingId, payload);
	const responseMeta = response.data as { bookingId?: number; bookingUid?: string };
	const resolvedEventTypeId =
		params.calEventTypeId ?? booking.eventTypeId ?? booking.eventType?.id;
	if (!resolvedEventTypeId) {
		throw new Error("Cal ID reschedule missing eventTypeId; cannot derive slot length.");
	}
	const eventTypeId = String(resolvedEventTypeId);
	const eventType = await fetchEventType(eventTypeId);
	const length = eventType.length ?? DEFAULT_SLOT_LENGTH_MIN;
	const appointmentStart = new Date(params.newSlotStart).toISOString();
	const appointmentEnd = new Date(
		new Date(params.newSlotStart).getTime() + length * 60_000,
	).toISOString();

	const newDate = new Date(params.newSlotStart).toISOString().slice(0, 10);
	await AvailabilityCache.deleteMany({ dateKey: newDate }).catch(() => {});

	return {
		...booking,
		id: responseMeta.bookingId ?? booking.id,
		uid: responseMeta.bookingUid ?? booking.uid,
		start: appointmentStart,
		end: appointmentEnd,
		startTime: appointmentStart,
		endTime: appointmentEnd,
	};
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelBooking(
	calBookingId: string | number,
	reason?: string,
): Promise<void> {
	await client.cancelBooking(calBookingId, {
		cancellationReason: reason,
	});
}

// ─── Fetch single booking (for reconciliation) ────────────────────────────────

export async function getBooking(uid: string): Promise<CalIdBookingData> {
	const response = await client.getBooking(uid);
	return response.data;
}

// ─── Re-exports for callers ───────────────────────────────────────────────────
export type { CalIdBookingData, SlotsByDay, CalIdSlotUnavailableError };
export { mapCalBookingToAppointmentFields };
