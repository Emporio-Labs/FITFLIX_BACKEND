/**
 * Timezone-coherent day/time math.
 *
 * Booking dates are stored as UTC midnight (`YYYY-MM-DDT00:00:00.000Z`) and
 * times as wall-clock "HH:mm" strings in the branch's local zone. Combining
 * them with the server's own clock — `setHours`, `getDay`, `getHours` — is only
 * correct when the server happens to run in the branch's timezone, and mixing
 * that with UTC-derived date strings is wrong in every zone.
 *
 * Two live bugs this replaces:
 *   - cancelUnifiedBooking built the session start with local `setHours` on a
 *     UTC-midnight date, so the refund window shifted by the server's offset.
 *   - calculateAvailableSlots compared `now.toISOString()` (UTC) against
 *     `now.getHours()` (local); on an IST server the "hide today's past slots"
 *     filter silently stopped working after 18:30, when the UTC date rolls over.
 *
 * Everything here works off an explicit IANA zone, defaulting to the branch's.
 */

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Offset of `date` from UTC, in minutes, for the given zone (IST → +330). */
const getZoneOffsetMinutes = (date: Date, timeZone: string): number => {
	// Formatting to en-US parts and re-reading them yields the wall-clock time
	// in that zone; the delta from the same instant read as UTC is the offset.
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});

	const parts = formatter.formatToParts(date);
	const lookup = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);

	// "24" appears at midnight in some locales/zones; normalise it to 0.
	const hour = lookup("hour") % 24;

	const asUtc = Date.UTC(
		lookup("year"),
		lookup("month") - 1,
		lookup("day"),
		hour,
		lookup("minute"),
		lookup("second"),
	);

	return (asUtc - date.getTime()) / 60000;
};

/** "YYYY-MM-DD" for an instant, as seen in the given zone. */
export const formatDateInZone = (
	date: Date,
	timeZone: string = DEFAULT_TIMEZONE,
): string => {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	// en-CA formats as YYYY-MM-DD.
	return formatter.format(date);
};

/** Minutes since midnight for an instant, as seen in the given zone. */
export const minutesIntoDayInZone = (
	date: Date,
	timeZone: string = DEFAULT_TIMEZONE,
): number => {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
	});

	const parts = formatter.formatToParts(date);
	const hour =
		Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
	const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

	return hour * 60 + minute;
};

/** Day of week (0 = Sunday) for an instant, as seen in the given zone. */
export const dayOfWeekInZone = (
	date: Date,
	timeZone: string = DEFAULT_TIMEZONE,
): number => {
	const weekday = new Intl.DateTimeFormat("en-US", {
		timeZone,
		weekday: "short",
	}).format(date);

	const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
		weekday,
	);
	return index === -1 ? date.getUTCDay() : index;
};

/**
 * The absolute instant of a wall-clock time on a given calendar day in a zone.
 *
 * `dateInput` may be a "YYYY-MM-DD" string or a Date stored at UTC midnight;
 * only its calendar day is used. `time` is "HH:mm" local to the branch.
 *
 * This is the function that makes "is the session more than 24 hours away?"
 * answerable correctly regardless of where the server runs.
 */
export const zonedDateTimeToInstant = (
	dateInput: string | Date,
	time: string,
	timeZone: string = DEFAULT_TIMEZONE,
): Date => {
	const dateStr =
		typeof dateInput === "string"
			? dateInput.slice(0, 10)
			: dateInput.toISOString().slice(0, 10);

	const [yearRaw, monthRaw, dayRaw] = dateStr.split("-").map(Number);
	const [hourRaw, minuteRaw] = String(time).split(":").map(Number);

	const year = yearRaw ?? 1970;
	const month = monthRaw ?? 1;
	const day = dayRaw ?? 1;
	const hour = hourRaw ?? 0;
	const minute = minuteRaw ?? 0;

	// Treat the wall-clock reading as UTC first, then subtract the zone's
	// offset at approximately that instant. Two passes so a DST boundary
	// between the guess and the true instant resolves correctly.
	const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

	let offsetMinutes = getZoneOffsetMinutes(new Date(naiveUtc), timeZone);
	let instant = new Date(naiveUtc - offsetMinutes * 60000);

	const refinedOffset = getZoneOffsetMinutes(instant, timeZone);
	if (refinedOffset !== offsetMinutes) {
		offsetMinutes = refinedOffset;
		instant = new Date(naiveUtc - offsetMinutes * 60000);
	}

	return instant;
};

/** Hours from `now` until a branch-local session start. Negative once past. */
export const hoursUntilZonedDateTime = (
	dateInput: string | Date,
	time: string,
	timeZone: string = DEFAULT_TIMEZONE,
	now: Date = new Date(),
): number => {
	const start = zonedDateTimeToInstant(dateInput, time, timeZone);
	return (start.getTime() - now.getTime()) / (1000 * 60 * 60);
};
