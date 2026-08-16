import type { RequestHandler } from "express";
import mongoose from "mongoose";
import BehaviourEvent from "../models/BehaviourEvent";
import User from "../models/User";
import {
	mayRecordBehaviour,
	MINOR_AGE_THRESHOLD,
	resolveAge,
} from "../utils/activity-consent";
import {
	MAX_CLOCK_SKEW_MS,
	recordActivitySchema,
	updateConsentSchema,
} from "../validators/activity.validator";

const invalidPayload = (
	res: Parameters<RequestHandler>[1],
	details: unknown,
) => {
	res.status(400).json({
		message: "Invalid payload",
		code: "INVALID_PAYLOAD",
		details,
	});
};

/**
 * Ingest a batch of behaviour events for the calling user.
 *
 * Consent is checked here, server-side, every time. The app also gates its own
 * sending, but a client-side gate is not a gate — this endpoint is reachable
 * regardless of what the app decides, and it is the only place the decision is
 * actually binding.
 *
 * A blocked batch answers 202 with `recorded: 0` and the reason rather than
 * 403. The caller is the data subject asking about their own record, so there
 * is nothing to withhold, and telling the app plainly lets it stop batching
 * instead of retrying forever against a wall.
 */
export const recordActivity: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			res
				.status(401)
				.json({ message: "Authentication required", code: "UNAUTHENTICATED" });
			return;
		}

		const parsed = recordActivitySchema.safeParse(req.body);
		if (!parsed.success) {
			invalidPayload(res, parsed.error.flatten());
			return;
		}

		const user = await User.findById(userId).select(
			"age dateOfBirth privacyConsent",
		);
		if (!user) {
			res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
			return;
		}

		const decision = mayRecordBehaviour(user);
		if (!decision.allowed) {
			res.status(202).json({ recorded: 0, skipped: decision.reason });
			return;
		}

		// A wrong device clock must not let an event park itself in the future
		// and pin to the top of every salesperson's view.
		const ceiling = Date.now() + MAX_CLOCK_SKEW_MS;
		const docs = parsed.data.events.map((e) => ({
			userId,
			event: e.event,
			params: e.params ?? {},
			occurredAt:
				e.occurredAt.getTime() > ceiling ? new Date() : e.occurredAt,
			sessionId: e.sessionId ?? null,
		}));

		// Unordered: one malformed row should not discard the rest of a batch
		// the user can never resend.
		await BehaviourEvent.insertMany(docs, { ordered: false });

		res.status(202).json({ recorded: docs.length });
	} catch (error) {
		next(error);
	}
};

/**
 * Your own consent state, plus whether it can be changed at all.
 *
 * `eligible` is false for a minor, so the app can explain why the control is
 * unavailable instead of showing a switch that silently refuses to move.
 */
export const getMyConsent: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			res
				.status(401)
				.json({ message: "Authentication required", code: "UNAUTHENTICATED" });
			return;
		}

		const user = await User.findById(userId).select(
			"age dateOfBirth privacyConsent",
		);
		if (!user) {
			res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
			return;
		}

		const age = resolveAge(user);
		res.status(200).json({
			behaviouralTracking: user.privacyConsent?.behaviouralTracking === true,
			eligible: age !== null && age >= MINOR_AGE_THRESHOLD,
		});
	} catch (error) {
		next(error);
	}
};

/**
 * Read or change your own tracking consent.
 *
 * Withdrawal has to be as easy as granting, so this is a plain toggle on the
 * user's own record rather than a support request. Turning it off also deletes
 * what was already collected — keeping a behavioural history for someone who
 * has just asked you to stop watching them is the wrong reading of "stop".
 */
export const updateMyConsent: RequestHandler = async (req, res, next) => {
	try {
		const userId = req.user?.id;
		if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
			res
				.status(401)
				.json({ message: "Authentication required", code: "UNAUTHENTICATED" });
			return;
		}

		const parsed = updateConsentSchema.safeParse(req.body);
		if (!parsed.success) {
			invalidPayload(res, parsed.error.flatten());
			return;
		}

		const user = await User.findById(userId).select("age dateOfBirth");
		if (!user) {
			res.status(404).json({ message: "User not found", code: "USER_NOT_FOUND" });
			return;
		}

		const age = resolveAge(user);
		// A minor cannot switch this on, and neither can anyone on their behalf.
		const granted =
			parsed.data.behaviouralTracking === true &&
			age !== null &&
			age >= MINOR_AGE_THRESHOLD;

		await User.findByIdAndUpdate(userId, {
			privacyConsent: {
				behaviouralTracking: granted,
				marketingContact: granted,
				updatedAt: new Date(),
			},
		});

		if (!granted) {
			await BehaviourEvent.deleteMany({ userId });
		}

		res.status(200).json({ behaviouralTracking: granted });
	} catch (error) {
		next(error);
	}
};

const SUMMARY_EVENT_LIMIT = 500;

/**
 * What to talk about on the call.
 *
 * Read by frontdesk before a salesperson phones someone, so it answers
 * "what has this person been looking at", not "how is the funnel doing" —
 * aggregate questions belong in Firebase.
 */
export const getInterestSummary: RequestHandler = async (req, res, next) => {
	try {
		const { userId } = req.params;
		if (typeof userId !== "string" || !mongoose.Types.ObjectId.isValid(userId)) {
			res
				.status(400)
				.json({ message: "Invalid user id", code: "INVALID_USER_ID" });
			return;
		}

		const objectId = new mongoose.Types.ObjectId(userId);
		const events = await BehaviourEvent.find({ userId: objectId })
			.sort({ occurredAt: -1 })
			.limit(SUMMARY_EVENT_LIMIT)
			.select("event params occurredAt");

		if (events.length === 0) {
			// An empty history is a normal answer, not a 404: the person may
			// simply not have consented, and saying so keeps the caller from
			// treating silence as an error.
			res.status(200).json({
				summary: {
					lastActiveAt: null,
					eventCount: 0,
					topInterests: [],
					planViews: 0,
					consultTaps: 0,
					mtmJoins: 0,
				},
			});
			return;
		}

		const interestCounts = new Map<
			string,
			{ type: string; id: string; count: number; lastViewedAt: Date }
		>();
		let planViews = 0;
		let consultTaps = 0;
		let mtmJoins = 0;

		for (const e of events) {
			if (e.event === "plan_view") planViews += 1;
			if (e.event === "consult_tap") consultTaps += 1;
			if (e.event === "mtm_join_tap") mtmJoins += 1;
			if (e.event !== "catalog_item_view") continue;

			const params = (e.params ?? {}) as Record<string, unknown>;
			const type = typeof params.type === "string" ? params.type : null;
			const id = typeof params.id === "string" ? params.id : null;
			if (!type || !id) continue;

			const mapKey = `${type}:${id}`;
			const existing = interestCounts.get(mapKey);
			if (existing) {
				existing.count += 1;
			} else {
				// Events arrive newest-first, so the first sighting is the latest.
				interestCounts.set(mapKey, {
					type,
					id,
					count: 1,
					lastViewedAt: e.occurredAt,
				});
			}
		}

		const topInterests = [...interestCounts.values()]
			.sort(
				(a, b) =>
					b.count - a.count ||
					b.lastViewedAt.getTime() - a.lastViewedAt.getTime(),
			)
			.slice(0, 5);

		res.status(200).json({
			summary: {
				lastActiveAt: events[0]?.occurredAt ?? null,
				eventCount: events.length,
				topInterests,
				planViews,
				consultTaps,
				mtmJoins,
			},
		});
	} catch (error) {
		next(error);
	}
};
