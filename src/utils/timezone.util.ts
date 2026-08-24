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

export const IST_TIMEZONE = "Asia/Kolkata";

/**
 * IST is +05:30 and observes no DST, so a single expected offset is a valid
 * assertion — which is what makes the runtime check below possible at all.
 */
export const IST_OFFSET_MINUTES = 330;

/** The original name for the same zone; kept so existing importers are untouched. */
export const DEFAULT_TIMEZONE = IST_TIMEZONE;

/** Offset of `date` from UTC, in minutes, for the given zone (IST → +330). */
export const getZoneOffsetMinutes = (date: Date, timeZone: string): number => {
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

/**
 * Names that are not IANA identifiers but keep turning up in env files, seed
 * data and admin input. Mapped rather than rejected: an operator who wrote
 * "IST" meant Asia/Kolkata, and quietly resolving that to UTC is precisely how
 * a whole platform shifts by five and a half hours without anyone noticing.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
	ist: IST_TIMEZONE,
	"asia/calcutta": IST_TIMEZONE,
	"india standard time": IST_TIMEZONE,
	"indian standard time": IST_TIMEZONE,
	kolkata: IST_TIMEZONE,
	calcutta: IST_TIMEZONE,
};

/**
 * Whether this runtime can actually resolve `timeZone`.
 *
 * `Intl` throws a RangeError for a zone it does not know, and it throws it at
 * the point of *use* — deep inside a request, long after the bad value was
 * configured. Probing here turns that into a boolean a caller can act on.
 */
export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
	if (typeof timeZone !== "string" || timeZone.trim() === "") {
		return false;
	}

	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
};

/// One warning per distinct bad value rather than per call: normalisation sits
/// on request paths that run on every video-token mint.
const warnedTimeZones = new Set<string>();

/**
 * Coerce anything configured or stored as a timezone into one this runtime can
 * use, falling back rather than throwing.
 *
 * The fallback is deliberate: a branch row with a junk `timezone`, or a `.env`
 * line that kept its quotes, must not take down every booking read. What it
 * must not do is fail *silently*, hence the one-time warning.
 */
export const normalizeTimeZone = (
	timeZone: unknown,
	fallback: string = IST_TIMEZONE,
): string => {
	const raw = typeof timeZone === "string" ? timeZone.trim() : "";
	// `BUSINESS_TIMEZONE="Asia/Kolkata"` in a .env that is sourced rather than
	// parsed keeps its quotes, and Intl rejects the quoted string.
	const unquoted = raw.replace(/^["']|["']$/g, "").trim();

	if (unquoted === "") {
		return fallback;
	}

	const alias = TIMEZONE_ALIASES[unquoted.toLowerCase()];
	if (alias) {
		return alias;
	}

	if (isValidTimeZone(unquoted)) {
		return unquoted;
	}

	if (!warnedTimeZones.has(unquoted)) {
		warnedTimeZones.add(unquoted);
		console.warn(
			`[timezone] "${unquoted}" is not a timezone this runtime knows — falling back to ${fallback}.`,
		);
	}

	return fallback;
};

export type TimeZoneCheckReason = "OK" | "INVALID_ZONE" | "OFFSET_MISMATCH";

export type TimeZoneVerdict = {
	ok: boolean;
	timeZone: string;
	expectedOffsetMinutes: number;
	actualOffsetMinutes: number | null;
	reason: TimeZoneCheckReason;
	message: string;
};

/**
 * The IST checker.
 *
 * Answers one question: does this process, with this configuration, put
 * wall-clock times where the business thinks they are?
 *
 * Two failures both produce a silently wrong platform rather than an error.
 * A runtime whose timezone data cannot resolve Asia/Kolkata reports every zone
 * as UTC; a box configured with `BUSINESS_TIMEZONE=UTC` does the same thing on
 * purpose. Either way a session stored as "17:45" is read as 17:45 UTC, so its
 * host join window opens at 22:45 IST and the host is refused their own class
 * all evening — which is exactly what happened in production.
 *
 * Returns a verdict instead of throwing, so the caller decides whether a
 * mismatch is fatal.
 */
export const verifyTimeZoneSupport = (
	timeZone: string = IST_TIMEZONE,
	expectedOffsetMinutes: number = IST_OFFSET_MINUTES,
	// A fixed instant, so the verdict never depends on when the process booted.
	referenceInstant: Date = new Date("2026-01-15T06:00:00.000Z"),
): TimeZoneVerdict => {
	if (!isValidTimeZone(timeZone)) {
		return {
			ok: false,
			timeZone: String(timeZone),
			expectedOffsetMinutes,
			actualOffsetMinutes: null,
			reason: "INVALID_ZONE",
			message: `This runtime cannot resolve the timezone "${String(timeZone)}".`,
		};
	}

	const actualOffsetMinutes = getZoneOffsetMinutes(referenceInstant, timeZone);
	if (actualOffsetMinutes !== expectedOffsetMinutes) {
		return {
			ok: false,
			timeZone,
			expectedOffsetMinutes,
			actualOffsetMinutes,
			reason: "OFFSET_MISMATCH",
			message:
				`"${timeZone}" resolves to UTC${formatOffset(actualOffsetMinutes)}, ` +
				`not UTC${formatOffset(expectedOffsetMinutes)}.`,
		};
	}

	return {
		ok: true,
		timeZone,
		expectedOffsetMinutes,
		actualOffsetMinutes,
		reason: "OK",
		message: `"${timeZone}" resolves to UTC${formatOffset(actualOffsetMinutes)}.`,
	};
};

/** "+05:30" / "-04:00", for messages a human has to read at 2am. */
export const formatOffset = (offsetMinutes: number): string => {
	const sign = offsetMinutes < 0 ? "-" : "+";
	const abs = Math.abs(offsetMinutes);
	const hours = String(Math.floor(abs / 60)).padStart(2, "0");
	const minutes = String(abs % 60).padStart(2, "0");
	return `${sign}${hours}:${minutes}`;
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
	const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
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

/** "HH:mm" for an instant, as seen in the given zone. Pairs with formatDateInZone. */
export const formatTimeInZone = (
	date: Date,
	timeZone: string = IST_TIMEZONE,
): string => {
	const minutes = minutesIntoDayInZone(date, timeZone);
	const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
	return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
};

/** The IST calendar day and wall clock an absolute instant falls on. */
export const instantToIstWallClock = (
	date: Date,
): { date: string; time: string } => ({
	date: formatDateInZone(date, IST_TIMEZONE),
	time: formatTimeInZone(date, IST_TIMEZONE),
});

export type IstConversion = {
	/** The unambiguous instant the source wall clock refers to. */
	instant: Date;
	/** The zone actually used, after validation — not necessarily what was passed. */
	sourceTimeZone: string;
	istDate: string;
	istTime: string;
};

/**
 * Validate a zone and express one of its wall-clock times as IST.
 *
 * A branch outside India stores "09:00" meaning 09:00 *there*; head office and
 * every IST-based report need the same moment in IST. Doing that as two steps
 * — resolve to an instant, then read it back — is what keeps the answer right
 * across a DST boundary in the source zone, which naive offset arithmetic gets
 * wrong twice a year.
 *
 * An unusable `fromTimeZone` degrades to IST via normalizeTimeZone rather than
 * throwing; `sourceTimeZone` in the result tells the caller what was used.
 */
export const convertZonedTimeToIst = (
	dateInput: string | Date,
	time: string,
	fromTimeZone: string = IST_TIMEZONE,
): IstConversion => {
	const sourceTimeZone = normalizeTimeZone(fromTimeZone);
	const instant = zonedDateTimeToInstant(dateInput, time, sourceTimeZone);

	return {
		instant,
		sourceTimeZone,
		istDate: formatDateInZone(instant, IST_TIMEZONE),
		istTime: formatTimeInZone(instant, IST_TIMEZONE),
	};
};
