import type { NormalizedSlot, SlotsByDay } from "./calcom.types";

// ─── Retry / backoff ──────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [250, 1000, 4000];

export async function withRetry<T>(
	fn: () => Promise<T>,
	retries = 3,
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;

			// Do not retry on client errors (4xx) — slot unavailable, bad request, etc.
			if (
				err instanceof Error &&
				"statusCode" in err &&
				typeof (err as { statusCode: unknown }).statusCode === "number" &&
				(err as { statusCode: number }).statusCode < 500
			) {
				throw err;
			}

			const delay = RETRY_DELAYS_MS[attempt];
			if (delay !== undefined && attempt < retries - 1) {
				await sleep(delay);
			}
		}
	}

	throw lastError;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Slot grouping ────────────────────────────────────────────────────────────

/**
 * Takes the raw Cal.com slots dict (keyed by "YYYY-MM-DD") and a slot duration
 * in minutes, then returns an array of { date, slots: [{start, end}] } in the
 * requested timezone.
 */
export function groupSlotsByDay(
	rawSlots: Record<string, Array<{ time: string }>>,
	slotDurationMinutes = 60,
): SlotsByDay[] {
	const days: SlotsByDay[] = [];

	for (const [dateKey, timeSlots] of Object.entries(rawSlots)) {
		const slots: NormalizedSlot[] = timeSlots.map((s) => {
			const start = s.time;
			const end = addMinutes(start, slotDurationMinutes);
			return { start, end };
		});

		if (slots.length > 0) {
			days.push({ date: dateKey, slots });
		}
	}

	// Sort ascending by date
	days.sort((a, b) => a.date.localeCompare(b.date));

	return days;
}

function addMinutes(isoString: string, minutes: number): string {
	const date = new Date(isoString);
	date.setMinutes(date.getMinutes() + minutes);
	return date.toISOString();
}

// ─── Cache key ────────────────────────────────────────────────────────────────

export function buildCacheKey(
	expertType: string,
	dateKey: string,
	timezone: string,
): string {
	return `${expertType}::${dateKey}::${timezone}`;
}

// ─── Date range helpers ───────────────────────────────────────────────────────

/** Returns YYYY-MM-DD for every day in [startDate, endDate] inclusive */
export function dateRange(startDate: string, endDate: string): string[] {
	const dates: string[] = [];
	const current = new Date(`${startDate}T00:00:00.000Z`);
	const end = new Date(`${endDate}T23:59:59.999Z`);

	while (current <= end) {
		dates.push(current.toISOString().slice(0, 10));
		current.setUTCDate(current.getUTCDate() + 1);
	}

	return dates;
}

/** ISO 8601 start-of-day in UTC for a YYYY-MM-DD date */
export function toStartOfDayUTC(dateKey: string): string {
	return `${dateKey}T00:00:00.000Z`;
}

/** ISO 8601 end-of-day in UTC for a YYYY-MM-DD date */
export function toEndOfDayUTC(dateKey: string): string {
	return `${dateKey}T23:59:59.999Z`;
}

// ─── Idempotency key ─────────────────────────────────────────────────────────

export function buildIdempotencyKey(
	userId: string,
	expertType: string,
	slotStart: string,
): string {
	// Deterministic key — same booking attempt always produces the same key
	return `${userId}:${expertType}:${new Date(slotStart).toISOString()}`;
}
