import mongoose from "mongoose";
import { MembershipStatus } from "../models/Enums";
import Membership from "../models/Membership";
import { formatDateInZone, zonedDateTimeToInstant } from "./timezone.util";

/**
 * When a sold membership runs, and whether it collides with one the member
 * already holds.
 *
 * Dates are branch-local calendar days: a membership sold for 1 Nov starts at
 * midnight on 1 Nov in the branch's zone, wherever the server runs.
 */

/** Statuses that still hold (or will hold) a member's days. */
export const LIVE_MEMBERSHIP_STATUSES = [
	MembershipStatus.Active,
	MembershipStatus.Paused,
	MembershipStatus.Upcoming,
];

/**
 * "YYYY-MM-DD" plus whole calendar months. A day the target month doesn't
 * have clamps to its last day (31 Jan + 1 month = 28/29 Feb), so a term is
 * never stretched into the month after.
 */
export const addCalendarMonths = (day: string, months: number): string => {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const monthIndex = m - 1 + months;
	const year = y + Math.floor(monthIndex / 12);
	const month = ((monthIndex % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const date = new Date(Date.UTC(year, month, Math.min(d, lastDay)));
	return date.toISOString().slice(0, 10);
};

const addDays = (day: string, days: number): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};

export type MembershipTerm = {
	startDate: Date;
	endDate: Date;
	status: MembershipStatus.Active | MembershipStatus.Upcoming;
};

/**
 * Start, end and initial status of a membership sold on an invoice.
 *
 * - start: `startDay` at branch midnight, else today (branch-local)
 * - end:   start + `durationMonths` calendar months, else + `durationInDays`
 * - status: Upcoming while the start day is still ahead, else Active
 */
export const resolveMembershipTerm = ({
	startDay,
	durationMonths,
	durationInDays,
	timeZone,
	now = new Date(),
}: {
	startDay?: string | null;
	durationMonths?: number | null;
	durationInDays: number;
	timeZone: string;
	now?: Date;
}): MembershipTerm => {
	const today = formatDateInZone(now, timeZone);
	const start = startDay || today;
	const end =
		durationMonths && durationMonths > 0
			? addCalendarMonths(start, durationMonths)
			: addDays(start, durationInDays);

	return {
		startDate: zonedDateTimeToInstant(start, "00:00", timeZone),
		endDate: zonedDateTimeToInstant(end, "00:00", timeZone),
		status: start > today ? MembershipStatus.Upcoming : MembershipStatus.Active,
	};
};

export class MembershipOverlapError extends Error {
	status = 409;
	code = "MEMBERSHIP_OVERLAP";
	details: { conflictingMembershipId: string; endDate: Date | null };

	constructor(conflicting: { _id: unknown; endDate?: Date | null }) {
		const until = conflicting.endDate
			? ` until ${conflicting.endDate.toISOString().slice(0, 10)}`
			: "";
		super(
			`Member already has a membership running${until}. Start the new one after it ends.`,
		);
		this.name = "MembershipOverlapError";
		this.details = {
			conflictingMembershipId: String(conflicting._id),
			endDate: conflicting.endDate ?? null,
		};
	}
}

/** The response body for a MembershipOverlapError. */
export const overlapErrorBody = (error: MembershipOverlapError) => ({
	error: error.message,
	code: error.code,
	details: error.details,
});

/**
 * Throws MembershipOverlapError when the member already has an
 * Active/Paused/Upcoming membership whose days intersect [start, end).
 * A membership with no endDate is open-ended and overlaps anything after
 * its start.
 */
export const assertNoMembershipOverlap = async (
	userId: string | mongoose.Types.ObjectId,
	startDate: Date,
	endDate: Date | null | undefined,
	session?: mongoose.ClientSession | null,
): Promise<void> => {
	const conflicting = await Membership.findOne({
		user: new mongoose.Types.ObjectId(String(userId)),
		status: { $in: LIVE_MEMBERSHIP_STATUSES },
		...(endDate ? { startDate: { $lt: endDate } } : {}),
		$or: [
			{ endDate: { $exists: false } },
			{ endDate: null },
			{ endDate: { $gt: startDate } },
		],
	})
		.select("_id endDate")
		.sort({ endDate: -1 })
		.session(session ?? null)
		.lean();

	if (conflicting) {
		throw new MembershipOverlapError(conflicting);
	}
};
