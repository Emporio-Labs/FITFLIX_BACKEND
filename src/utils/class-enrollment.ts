/**
 * Batch-class enrolment rules, as pure functions.
 *
 * A `drop_in` class books per occurrence, gated by a window expressed as an
 * offset from that occurrence's start time (bookingWindowValue /
 * bookingCloseValue). A `batch` runs as a cohort: it opens and closes once, on
 * absolute dates, and the per-occurrence offsets do not apply to it.
 *
 * The two schemes are different shapes — relative vs absolute — which is why
 * this lives apart from the offset arithmetic in booking-rules-engine.service
 * rather than being folded into it.
 */

export type ClassFormat = "drop_in" | "batch";

export interface EnrollmentConfig {
	format?: ClassFormat | null;
	startDate?: Date | string | null;
	endDate?: Date | string | null;
	enrollmentOpensAt?: Date | string | null;
	enrollmentClosesAt?: Date | string | null;
}

export interface EnrollmentDecision {
	allowed: boolean;
	/** Machine-readable reason, absent when allowed. */
	code?:
		| "ENROLLMENT_NOT_OPEN"
		| "ENROLLMENT_CLOSED"
		| "BATCH_ENDED";
	message?: string;
	details?: Record<string, unknown>;
}

/**
 * Anything not explicitly marked `batch` is a drop-in.
 *
 * Existing documents predate the field entirely, so `undefined` has to read as
 * drop-in — that is what keeps every class already in the database on exactly
 * the code path it was on before.
 */
export const isBatchClass = (config: EnrollmentConfig | null | undefined): boolean =>
	config?.format === "batch";

const toDate = (value: Date | string | null | undefined): Date | null => {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Whether a member may enrol in a batch right now.
 *
 * Every bound is optional and each one is skipped when absent, so a batch with
 * no enrolment window configured is open for its whole run. Bounds are
 * inclusive: a cohort that opens at 09:00 is joinable at exactly 09:00.
 */
export const evaluateEnrollmentWindow = (
	config: EnrollmentConfig,
	now: Date = new Date(),
): EnrollmentDecision => {
	const opensAt = toDate(config.enrollmentOpensAt);
	const closesAt = toDate(config.enrollmentClosesAt);
	const endDate = toDate(config.endDate);

	if (opensAt && now < opensAt) {
		return {
			allowed: false,
			code: "ENROLLMENT_NOT_OPEN",
			message: "Enrolment for this batch has not opened yet",
			details: { enrollmentOpensAt: opensAt },
		};
	}

	if (closesAt && now > closesAt) {
		return {
			allowed: false,
			code: "ENROLLMENT_CLOSED",
			message: "Enrolment for this batch has closed",
			details: { enrollmentClosesAt: closesAt },
		};
	}

	// A batch with no explicit close still cannot be joined once its run is
	// over — the end of the run is an implicit close.
	if (endDate && now > endDate) {
		return {
			allowed: false,
			code: "BATCH_ENDED",
			message: "This batch has already finished",
			details: { endDate },
		};
	}

	return { allowed: true };
};
