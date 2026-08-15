const DAY_MS = 24 * 60 * 60 * 1000;

type PlanDurationFields = {
	durationDays?: number | null;
	durationMonths?: number | null;
};

/**
 * How many days a plan is sold for.
 *
 * `durationDays` wins when present; otherwise months are converted at 30 days.
 * Falls back to 30 so a misconfigured plan still yields a sane term rather than
 * an immediate expiry.
 */
export const resolvePlanDurationDays = (plan: PlanDurationFields): number => {
	const days = Number(plan.durationDays ?? 0);
	if (Number.isFinite(days) && days > 0) {
		return Math.floor(days);
	}

	const months = Number(plan.durationMonths ?? 0);
	if (Number.isFinite(months) && months > 0) {
		return Math.floor(months) * 30;
	}

	return 30;
};

/**
 * End date for a brand-new membership: simply now + the plan's term.
 */
export const computeNewEndDate = (
	plan: PlanDurationFields,
	now: Date = new Date(),
): Date => new Date(now.getTime() + resolvePlanDurationDays(plan) * DAY_MS);

/**
 * End date when topping up or renewing an existing membership.
 *
 * The new term is added to whatever the member already has left, not to `now`.
 * The previous implementation set endDate to `now + term` (and, in the credits
 * path, to the last day of the current calendar month), which meant renewing
 * early *destroyed* unused days — and buying late in a month yielded a term of
 * a few days regardless of what the plan sold.
 *
 * Guarantees the returned date is never earlier than the current one.
 */
export const computeRenewalEndDate = (
	plan: PlanDurationFields,
	currentEndDate: Date | null | undefined,
	now: Date = new Date(),
): Date => {
	const termMs = resolvePlanDurationDays(plan) * DAY_MS;

	// Anchor on the existing expiry only while it is still in the future;
	// a lapsed membership restarts from now.
	const current = currentEndDate ? new Date(currentEndDate) : null;
	const anchor =
		current && current.getTime() > now.getTime() ? current : new Date(now);

	const extended = new Date(anchor.getTime() + termMs);

	// Belt and braces: never hand back an earlier date than the member had.
	if (current && extended.getTime() < current.getTime()) {
		return current;
	}

	return extended;
};
