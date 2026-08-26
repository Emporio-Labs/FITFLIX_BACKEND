/**
 * Shared time parsing and arithmetic utilities.
 */

export function timeToMinutes(value: string | null | undefined): number | null {
	if (!value || typeof value !== "string") return null;
	const [hoursRaw, minutesRaw] = value.split(":");
	const hours = Number(hoursRaw);
	const minutes = Number(minutesRaw);

	if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
		return null;
	}

	if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
		return null;
	}

	return hours * 60 + minutes;
}

export function minutesToTime(minutes: number): string {
	const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;
	const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
	const mm = String(normalized % 60).padStart(2, "0");
	return `${hh}:${mm}`;
}

export function calculateDurationMinutes(
	startTime: string,
	endTime: string,
): number {
	const start = timeToMinutes(startTime);
	const end = timeToMinutes(endTime);
	if (start === null || end === null) return 0;
	if (end >= start) {
		return end - start;
	}
	// Wraps around midnight
	return 1440 - start + end;
}

export function isIntervalOverlapping(
	startA: number,
	endA: number,
	startB: number,
	endB: number,
): boolean {
	// Half-open interval test: [startA, endA) overlaps with [startB, endB)
	return startA < endB && endA > startB;
}
