import type mongoose from "mongoose";
import Booking from "../models/Bookings";
import { BookingStatus, LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";

/**
 * FX-27 — branch sign-up + booking funnels for the Frontdesk Analytics page.
 *
 * Pure data layer: the caller hands in an already-scoped Mongo `locationFilter`
 * (from `scopedLocationFilter`, which encodes the branch the request may see)
 * plus a date window, and this returns the two funnels. All branch-access
 * decisions happen in the controller/middleware, never here.
 *
 * Both source collections carry `locationId` and `createdAt` (timestamps), so
 * the same `{ ...locationFilter, createdAt: {…} }` base match scopes both.
 */

export interface FunnelStep {
	key: string;
	label: string;
	count: number;
}

export interface Funnel {
	key: "signup" | "booking";
	title: string;
	steps: FunnelStep[];
}

/* --------------------------------------------------------------------------
 * Stage membership
 *
 * A record's *current* status implies the stages it has already passed: a
 * Converted lead was once Contacted and Qualified, an Attended booking was once
 * Confirmed. So each stage's filter is the set of statuses at-or-beyond it, and
 * each subsequent set is a subset of the previous one — the counts come out
 * monotonically non-increasing, as a funnel must.
 * ------------------------------------------------------------------------ */

// Leads. `status` is a clean string enum. Warm/Hot are temperature labels the
// backend happens to store in `status`; both sit at the Qualified tier here.
const CONTACTED_PLUS: LeadStatus[] = [
	LeadStatus.Contacted,
	LeadStatus.Qualified,
	LeadStatus.Warm,
	LeadStatus.Hot,
	LeadStatus.Converted,
];
const QUALIFIED_PLUS: LeadStatus[] = [
	LeadStatus.Qualified,
	LeadStatus.Warm,
	LeadStatus.Hot,
	LeadStatus.Converted,
];

// Bookings. `BookingStatus` is a NUMERIC enum (Booked=0 … Attended=3), but the
// Booking schema stores `status` as a string whose enum allows the name, the
// number, the number-as-string, and the extra labels "Confirmed"/"Pending"/
// "Consumed". Legacy rows use any of these, so match every representation.
// `variants("Attended")` → ["Attended", 3, "3"].
const variants = (name: keyof typeof BookingStatus): Array<string | number> => {
	const n = BookingStatus[name] as unknown as number;
	return [name, n, String(n)];
};
// "Confirmed or better": confirmed, attended, no-show-after-confirm, and the
// credit-consumed alias. Deliberately excludes Booked(0)/Pending/Cancelled.
const CONFIRMED_PLUS: Array<string | number> = [
	...variants("Confirmed"),
	...variants("Attended"),
	...variants("Unattended"),
	"Consumed",
];
const ATTENDED: Array<string | number> = [...variants("Attended"), "Consumed"];

interface StageDef {
	key: string;
	label: string;
	/** Omitted on the first (top) stage — it counts everything in the base match. */
	match?: Record<string, unknown>;
}

/**
 * Run one funnel as a single aggregation: a top-level `$match` (branch + date)
 * then a `$facet` that counts each stage's refinement of that set. One DB round
 * trip per collection.
 */
async function computeFunnel(
	// biome-ignore lint/suspicious/noExplicitAny: model union is intentionally loose
	model: mongoose.Model<any>,
	baseMatch: Record<string, unknown>,
	stages: StageDef[],
): Promise<FunnelStep[]> {
	const facet: Record<string, mongoose.PipelineStage.FacetPipelineStage[]> = {};
	stages.forEach((stage, i) => {
		facet[`s${i}`] = [
			...(stage.match ? [{ $match: stage.match }] : []),
			{ $count: "n" },
		];
	});

	const pipeline: mongoose.PipelineStage[] = [
		{ $match: baseMatch },
		{ $facet: facet },
	];
	const [agg] = await model.aggregate(pipeline);

	return stages.map((stage, i) => ({
		key: stage.key,
		label: stage.label,
		count: agg?.[`s${i}`]?.[0]?.n ?? 0,
	}));
}

export async function buildBranchFunnels(params: {
	locationFilter: Record<string, unknown>;
	from: Date;
	to: Date;
}): Promise<Funnel[]> {
	const base: Record<string, unknown> = {
		...params.locationFilter,
		createdAt: { $gte: params.from, $lte: params.to },
	};

	const [signupSteps, bookingSteps] = await Promise.all([
		computeFunnel(Lead, base, [
			{ key: "leads", label: "Leads" },
			{
				key: "contacted",
				label: "Contacted",
				match: {
					$or: [
						{ status: { $in: CONTACTED_PLUS } },
						{ contactCount: { $gt: 0 } },
					],
				},
			},
			{
				key: "qualified",
				label: "Qualified",
				match: { status: { $in: QUALIFIED_PLUS } },
			},
			{
				key: "converted",
				label: "Converted",
				match: {
					$or: [
						{ status: LeadStatus.Converted },
						{ convertedUser: { $ne: null } },
					],
				},
			},
		]),
		computeFunnel(Booking, base, [
			{ key: "booked", label: "Bookings created" },
			{
				key: "confirmed",
				label: "Confirmed",
				match: { status: { $in: CONFIRMED_PLUS } },
			},
			{
				key: "attended",
				label: "Attended",
				match: { status: { $in: ATTENDED } },
			},
		]),
	]);

	return [
		{ key: "signup", title: "Sign-up funnel", steps: signupSteps },
		{ key: "booking", title: "Booking funnel", steps: bookingSteps },
	];
}
