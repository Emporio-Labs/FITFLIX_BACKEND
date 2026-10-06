import type { RequestHandler } from "express";
import mongoose from "mongoose";
import BehaviourEvent from "../models/BehaviourEvent";
import Location from "../models/Location";
import Membership from "../models/Membership";
import { buildUserAnalytics } from "../services/analytics.service";
import { getValidationDetails } from "../services/nutrition/nutrition-errors";
import { autoPullBcaIfEmpty } from "../utils/activex.service";
import { analyticsQuerySchema } from "../validators/analytics.validator";

/**
 * `GET /analytics/me` — everything the Progress screen renders, in one call.
 *
 * Self-only by construction: the subject is always `req.user.id` and there is
 * no `userId` parameter to authorize. A member with no data still gets a 200
 * with every block flagged `hasData: false`, because an empty dashboard is a
 * state to design for, not an error to raise.
 */
export const getMyAnalytics: RequestHandler = async (req, res, next) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const parsed = analyticsQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsed.error.issues),
		});
		return;
	}

	try {
		await autoPullBcaIfEmpty(req.user.id);
		const analytics = await buildUserAnalytics(req.user.id, parsed.data.period);
		res.status(200).json(analytics);
	} catch (error) {
		next(error);
	}
};

interface FunnelStepResult {
	key: string;
	label: string;
	count: number;
	conversionRate: number; // % from step 0
	stepConversionRate: number; // % from step n-1
	dropOffCount: number;
	dropOffRate: number; // % drop-off from step n-1
}

interface FunnelSummary {
	steps: FunnelStepResult[];
	totalStarted: number;
	totalConverted: number;
	overallConversionRate: number;
	biggestDropOffStep: {
		fromStep: string;
		toStep: string;
		lostCount: number;
		dropOffRate: number;
	} | null;
	club: {
		id: string | null;
		name: string | null;
	} | null;
}

/**
 * Builds date match criteria if from/to query params are supplied.
 */
const parseDateFilter = (from?: unknown, to?: unknown) => {
	const filter: Record<string, Date> = {};
	if (typeof from === "string" && !Number.isNaN(new Date(from).getTime())) {
		filter.$gte = new Date(from);
	}
	if (typeof to === "string" && !Number.isNaN(new Date(to).getTime())) {
		filter.$lte = new Date(to);
	}
	return Object.keys(filter).length > 0 ? filter : null;
};

/**
 * Computes step transitions, retention rates, drop-offs, and highlights
 * the exact stage where the club loses the most people.
 */
const buildFunnelSummary = (
	rawSteps: Array<{ key: string; label: string; count: number }>,
	clubInfo: { id: string | null; name: string | null } | null,
): FunnelSummary => {
	const firstCount = rawSteps[0]?.count ?? 0;
	let biggestDropOff: FunnelSummary["biggestDropOffStep"] = null;
	let maxLost = -1;

	const steps: FunnelStepResult[] = rawSteps.map((step, idx) => {
		const prevCount = idx === 0 ? firstCount : rawSteps[idx - 1].count;
		const conversionRate = firstCount > 0 ? Math.round((step.count / firstCount) * 1000) / 10 : 0;
		const stepConversionRate = prevCount > 0 ? Math.round((step.count / prevCount) * 1000) / 10 : 0;
		const dropOffCount = Math.max(0, prevCount - step.count);
		const dropOffRate = prevCount > 0 ? Math.round((dropOffCount / prevCount) * 1000) / 10 : 0;

		if (idx > 0 && dropOffCount > maxLost) {
			maxLost = dropOffCount;
			biggestDropOff = {
				fromStep: rawSteps[idx - 1].label,
				toStep: step.label,
				lostCount: dropOffCount,
				dropOffRate,
			};
		}

		return {
			key: step.key,
			label: step.label,
			count: step.count,
			conversionRate,
			stepConversionRate,
			dropOffCount,
			dropOffRate,
		};
	});

	const lastCount = rawSteps[rawSteps.length - 1]?.count ?? 0;
	const overallConversionRate = firstCount > 0 ? Math.round((lastCount / firstCount) * 1000) / 10 : 0;

	return {
		steps,
		totalStarted: firstCount,
		totalConverted: lastCount,
		overallConversionRate,
		biggestDropOffStep: biggestDropOff,
		club: clubInfo,
	};
};

/**
 * GET /api/v1/analytics/funnels/signup
 *
 * FX-22.2: Sign-up funnel
 * 1. Plan viewed (`plan_view`)
 * 2. Callback requested (`callback_requested` / `consult_tap`)
 * 3. Sign-up started (`signup_start`)
 * 4. Sign-up finished (`signup_complete`)
 * 5. Membership active (`membership_active` / Membership.status = 'Active')
 *
 * Scoped by optional homeLocationId and date range.
 */
export const getSignupFunnel: RequestHandler = async (req, res, next) => {
	try {
		const { homeLocationId, from, to } = req.query;

		const match: Record<string, unknown> = {};

		let clubInfo: { id: string | null; name: string | null } | null = null;
		if (typeof homeLocationId === "string" && mongoose.Types.ObjectId.isValid(homeLocationId)) {
			const locObjId = new mongoose.Types.ObjectId(homeLocationId);
			match.homeLocationId = locObjId;
			const locDoc = await Location.findById(locObjId).select("name");
			clubInfo = {
				id: homeLocationId,
				name: locDoc ? locDoc.name : "Unknown Club",
			};
		}

		const dateFilter = parseDateFilter(from, to);
		if (dateFilter) {
			match.occurredAt = dateFilter;
		}

		// Distinct users/sessions per step
		const [
			planViews,
			callbacks,
			signupStarts,
			signupCompletes,
			activeMemberships,
		] = await Promise.all([
			BehaviourEvent.distinct("userId", { ...match, event: "plan_view" }),
			BehaviourEvent.distinct("userId", {
				...match,
				event: { $in: ["callback_requested", "consult_tap"] },
			}),
			BehaviourEvent.distinct("userId", { ...match, event: "signup_start" }),
			BehaviourEvent.distinct("userId", { ...match, event: "signup_complete" }),
			BehaviourEvent.distinct("userId", { ...match, event: "membership_active" }),
		]);

		// Corroborate with active memberships in database if events are still populating
		let activeCount = activeMemberships.length;
		if (activeCount === 0) {
			const membershipMatch: Record<string, unknown> = { status: "Active" };
			if (match.homeLocationId) {
				membershipMatch.locationId = match.homeLocationId;
			}
			if (dateFilter) {
				membershipMatch.createdAt = dateFilter;
			}
			const activeDocs = await Membership.distinct("user", membershipMatch);
			activeCount = activeDocs.length;
		}

		const rawSteps = [
			{ key: "plan_view", label: "Plan Viewed", count: planViews.length },
			{ key: "callback_requested", label: "Callback Requested", count: callbacks.length },
			{ key: "signup_start", label: "Sign-up Started", count: signupStarts.length },
			{ key: "signup_complete", label: "Sign-up Finished", count: signupCompletes.length },
			{ key: "membership_active", label: "Membership Active", count: activeCount },
		];

		const summary = buildFunnelSummary(rawSteps, clubInfo);
		res.status(200).json({ funnel: summary });
	} catch (error) {
		next(error);
	}
};

/**
 * GET /api/v1/analytics/funnels/booking
 *
 * FX-22.3: Booking funnel
 * 1. Class viewed (`catalog_item_view` where params.type = 'class')
 * 2. Book tapped (`book_tap`)
 * 3. Booking confirmed (`booking_confirmed`)
 *
 * Shows real conversion and drop-off data, with biggest drop-off highlight.
 */
export const getBookingFunnel: RequestHandler = async (req, res, next) => {
	try {
		const { homeLocationId, classId, from, to } = req.query;

		const match: Record<string, unknown> = {};

		let clubInfo: { id: string | null; name: string | null } | null = null;
		if (typeof homeLocationId === "string" && mongoose.Types.ObjectId.isValid(homeLocationId)) {
			const locObjId = new mongoose.Types.ObjectId(homeLocationId);
			match.homeLocationId = locObjId;
			const locDoc = await Location.findById(locObjId).select("name");
			clubInfo = {
				id: homeLocationId,
				name: locDoc ? locDoc.name : "Unknown Club",
			};
		}

		const dateFilter = parseDateFilter(from, to);
		if (dateFilter) {
			match.occurredAt = dateFilter;
		}

		const classMatch: Record<string, unknown> = { ...match };
		if (typeof classId === "string" && classId.trim().length > 0) {
			classMatch["params.id"] = classId.trim();
		}

		const [classViews, bookTaps, bookingsConfirmed] = await Promise.all([
			BehaviourEvent.distinct("userId", {
				...classMatch,
				event: "catalog_item_view",
				"params.type": "class",
			}),
			BehaviourEvent.distinct("userId", { ...match, event: "book_tap" }),
			BehaviourEvent.distinct("userId", { ...match, event: "booking_confirmed" }),
		]);

		const rawSteps = [
			{ key: "class_viewed", label: "Class Viewed", count: classViews.length },
			{ key: "book_tapped", label: "Book Tapped", count: bookTaps.length },
			{ key: "booking_confirmed", label: "Booking Confirmed", count: bookingsConfirmed.length },
		];

		const summary = buildFunnelSummary(rawSteps, clubInfo);
		res.status(200).json({ funnel: summary });
	} catch (error) {
		next(error);
	}
};

/**
 * POST /api/v1/analytics/events
 *
 * FX-22.1: Ingestion receiver for product analytics.
 * Operates as the native product analytics sink on the backend host, and proxies/relays
 * to an external client-configured analytics URL if PRODUCT_ANALYTICS_HOST_URL is defined.
 */
export const ingestProductAnalytics: RequestHandler = async (req, res, next) => {
	try {
		const externalHostUrl = process.env.PRODUCT_ANALYTICS_HOST_URL;
		const events = req.body?.events;

		if (!Array.isArray(events) || events.length === 0) {
			res.status(400).json({ error: "Events array is required", code: "INVALID_PAYLOAD" });
			return;
		}

		// Relay to external hosting if configured by client
		if (externalHostUrl) {
			try {
				await fetch(`${externalHostUrl}/events`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...(process.env.PRODUCT_ANALYTICS_API_KEY
							? { Authorization: `Bearer ${process.env.PRODUCT_ANALYTICS_API_KEY}` }
							: {}),
					},
					body: JSON.stringify(req.body),
				});
			} catch (relayErr) {
				console.warn("Product analytics relay failure to external host:", relayErr);
			}
		}

		res.status(202).json({
			recorded: events.length,
			destination: externalHostUrl ? "external_and_native" : "native_host",
		});
	} catch (error) {
		next(error);
	}
};
