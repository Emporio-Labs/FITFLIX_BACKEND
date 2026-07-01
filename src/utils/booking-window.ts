// ---------------------------------------------------------------------------
// booking-window.ts
//
// Pure, side-effect-free utility for booking window validation.
// No DB imports — all inputs are injected, making this trivially unit-testable.
// ---------------------------------------------------------------------------

/**
 * Parses an "HH:MM" (or "HH:MM:SS") UTC time string into hours and minutes.
 * Returns `{ hours, minutes }` or throws if the format is unrecognised.
 */
function parseStartTime(startTime: string): { hours: number; minutes: number } {
	const parts = startTime.trim().split(":");

	if (parts.length < 2) {
		throw new Error(
			`Invalid startTime format "${startTime}": expected "HH:MM" or "HH:MM:SS"`,
		);
	}

	const hours = parseInt(parts[0]!, 10);
	const minutes = parseInt(parts[1]!, 10);

	if (
		!Number.isFinite(hours) ||
		!Number.isFinite(minutes) ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59
	) {
		throw new Error(
			`Invalid startTime value "${startTime}": hours/minutes out of range`,
		);
	}

	return { hours, minutes };
}

/**
 * Combines a UTC date object (time portion is ignored) and an "HH:MM" startTime
 * string into a single UTC epoch millisecond timestamp representing the exact
 * moment the class starts.
 *
 * @param date      - The calendar date of the slot (UTC midnight-normalised).
 * @param startTime - "HH:MM" or "HH:MM:SS" 24-hour UTC string from the Slot document.
 * @returns Epoch milliseconds of the class start moment.
 */
export function buildClassStartTimestamp(
	date: Date,
	startTime: string,
): number {
	const { hours, minutes } = parseStartTime(startTime);

	return Date.UTC(
		date.getUTCFullYear(),
		date.getUTCMonth(),
		date.getUTCDate(),
		hours,
		minutes,
		0,
		0,
	);
}

// ---------------------------------------------------------------------------
// Window check result — discriminated union
// ---------------------------------------------------------------------------

export type BookingWindowCheck =
	| { ok: true }
	| {
			ok: false;
			code: "BOOKING_WINDOW_NOT_OPEN";
			/** The earliest point in time when a booking will be accepted. */
			opensAt: Date;
	  }
	| {
			ok: false;
			code: "BOOKING_WINDOW_CLOSED";
			/** The class start time — bookings past this point are rejected. */
			startedAt: Date;
	  };

/**
 * Validates whether the current moment falls within the allowed booking window.
 *
 * Window rules:
 *   - Bookings are accepted starting `windowOpenHours` hours before class start.
 *   - Bookings are rejected once the class start time has been reached or passed.
 *
 * @param nowMs           - Current epoch milliseconds (use `Date.now()`).
 * @param classStartMs    - Class start epoch milliseconds (from `buildClassStartTimestamp`).
 * @param windowOpenHours - How many hours before start the window opens (e.g. 72).
 * @returns A `BookingWindowCheck` discriminated union.
 */
export function checkBookingWindow(
	nowMs: number,
	classStartMs: number,
	windowOpenHours: number,
): BookingWindowCheck {
	const windowOpenMs = classStartMs - windowOpenHours * 60 * 60 * 1000;

	// Current time is before the window opens (too early).
	if (nowMs < windowOpenMs) {
		return {
			ok: false,
			code: "BOOKING_WINDOW_NOT_OPEN",
			opensAt: new Date(windowOpenMs),
		};
	}

	// Current time is at or after class start (too late).
	if (nowMs >= classStartMs) {
		return {
			ok: false,
			code: "BOOKING_WINDOW_CLOSED",
			startedAt: new Date(classStartMs),
		};
	}

	return { ok: true };
}
