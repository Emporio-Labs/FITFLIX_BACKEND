/**
 * Resolves a membership plan's end date from a start date.
 *
 * Mirrors the admin dashboard's Assign Membership dialog
 * (app/admin/memberships/page.tsx:216-223 in the frontdesk-fitflix repo) so the
 * admin-assigned path and the online-payment provisioning path can never disagree
 * about when a membership ends.
 *
 * `durationDays`, when set, always wins (day-based plans). Otherwise the plan is
 * treated as month-based and resolved with true calendar-month arithmetic — 12
 * months lands on the same day one year later, not 360 days later.
 */
export function resolvePlanEndDate(
	plan: { durationDays?: number | null; durationMonths?: number | null },
	from: Date,
): Date {
	const end = new Date(from);
	if (plan.durationDays && plan.durationDays > 0) {
		end.setDate(end.getDate() + plan.durationDays);
	} else {
		end.setMonth(end.getMonth() + (plan.durationMonths || 1));
	}
	return end;
}

/**
 * Duration in days for a plan, used for informational quote payloads
 * (pre-purchase Razorpay order summaries). Not used for the actual end date —
 * use resolvePlanEndDate for that, since "durationMonths * 30" is an approximation.
 */
export function resolvePlanDurationDays(plan: {
	durationDays?: number | null;
	durationMonths?: number | null;
}): number {
	if (plan.durationDays && plan.durationDays > 0) {
		return plan.durationDays;
	}
	return (plan.durationMonths || 1) * 30;
}
