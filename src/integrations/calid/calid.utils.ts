import type { NormalizedSlot, SlotsByDay } from "./calid.types";

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
 * Groups normalized slots by their UTC date key (YYYY-MM-DD).
 * Used after local slot derivation to produce the SlotsByDay[] shape the
 * controller already returns.
 */
export function groupSlotsByDay(slots: NormalizedSlot[]): SlotsByDay[] {
	const byDay = new Map<string, NormalizedSlot[]>();
	for (const slot of slots) {
		const dateKey = slot.start.slice(0, 10);
		const bucket = byDay.get(dateKey);
		if (bucket) bucket.push(slot);
		else byDay.set(dateKey, [slot]);
	}

	const days: SlotsByDay[] = [];
	for (const [date, daySlots] of byDay) {
		daySlots.sort((a, b) => a.start.localeCompare(b.start));
		days.push({ date, slots: daySlots });
	}
	days.sort((a, b) => a.date.localeCompare(b.date));
	return days;
}

// ─── Date range helpers ───────────────────────────────────────────────────────

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

export function toStartOfDayUTC(dateKey: string): string {
	return `${dateKey}T00:00:00.000Z`;
}

export function toEndOfDayUTC(dateKey: string): string {
	return `${dateKey}T23:59:59.999Z`;
}

// ─── Idempotency key ─────────────────────────────────────────────────────────

export function buildIdempotencyKey(
	userId: string,
	expertType: string,
	slotStart: string,
): string {
	// Deterministic — same booking attempt always produces the same key
	return `${userId}:${expertType}:${new Date(slotStart).toISOString()}`;
}
