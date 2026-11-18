import type { RequestHandler, Response } from "express";
import mongoose from "mongoose";
import { normalizeRole } from "../middleware/rbac.middleware";
import User from "../models/User";
import { WearableSource } from "../models/wearable.model";
import { assertNutritionistOwnsMember } from "../services/nutritionistRoster.service";
import { assertTrainerOwnsMember } from "../services/trainerRoster.service";
import {
	connectSource,
	disconnectSource,
	getWearableSeries,
	listConnections,
	loadConsentSubject,
	purgeWearableDataForUser,
	syncWearableData,
} from "../services/wearable.service";
import {
	isEligibleForWearables,
	mayStaffViewWearableData,
	mayStoreWearableData,
} from "../utils/wearable-consent";
import {
	connectWearableSchema,
	syncWearableSchema,
	updateWearableConsentSchema,
	wearableRangeQuerySchema,
} from "../validators/wearable.validator";

const validationError = (
	res: Response,
	issues: { path: PropertyKey[]; message: string }[],
) => {
	res.status(400).json({
		error: "Validation failed",
		code: "VALIDATION_ERROR",
		details: issues.map((i) => ({
			field: i.path.map(String).join("."),
			message: i.message,
		})),
	});
};

const requireMember = (
	req: Parameters<RequestHandler>[0],
	res: Response,
): string | null => {
	if (
		!req.user ||
		req.user.role !== "user" ||
		!mongoose.Types.ObjectId.isValid(req.user.id)
	) {
		res.status(403).json({ error: "Access denied", code: "FORBIDDEN" });
		return null;
	}
	return req.user.id;
};

const CONSENT_ERRORS = {
	minor: "Wearable sync isn't available for members under 18.",
	unknown_age: "Add your date of birth to your profile to use wearable sync.",
	no_consent: "Turn on wearable sync in Privacy settings first.",
} as const;

/** GET /consent — own consent state, plus whether it can be switched on at all. */
export const getWearableConsent: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;
	try {
		const user = await loadConsentSubject(userId);
		if (!user) {
			res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
			return;
		}
		res.status(200).json({
			success: true,
			data: {
				wearableSync: user.healthDataConsent?.wearableSync === true,
				coachSharing: user.healthDataConsent?.coachSharing === true,
				eligible: isEligibleForWearables(user),
				updatedAt: user.healthDataConsent?.updatedAt ?? null,
			},
		});
	} catch (error) {
		next(error);
	}
};

/**
 * PATCH /consent — grant or withdraw. Withdrawal is as easy as granting, and
 * turning sync off deletes everything already synced.
 */
export const updateWearableConsent: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;

	const parsed = updateWearableConsentSchema.safeParse(req.body);
	if (!parsed.success) {
		validationError(res, parsed.error.issues);
		return;
	}

	try {
		const user = await loadConsentSubject(userId);
		if (!user) {
			res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
			return;
		}

		const eligible = isEligibleForWearables(user);
		const current = user.healthDataConsent;
		const wantSync = parsed.data.wearableSync ?? current?.wearableSync === true;
		const wantSharing =
			parsed.data.coachSharing ?? current?.coachSharing === true;

		if (wantSync && !eligible) {
			// Ask the consent rule as if they had agreed, so the only refusal
			// left is the age one — that tells us which message to show.
			const decision = mayStoreWearableData({
				...user,
				healthDataConsent: { wearableSync: true },
			});
			const reason = decision.allowed ? "unknown_age" : decision.reason;
			res.status(403).json({
				error: CONSENT_ERRORS[reason],
				code: "NOT_ELIGIBLE",
				reason,
			});
			return;
		}

		const wearableSync = wantSync && eligible;
		// Sharing without syncing is meaningless, so it can't outlive sync.
		const coachSharing = wearableSync && wantSharing;

		await User.updateOne(
			{ _id: userId },
			{
				$set: {
					healthDataConsent: {
						wearableSync,
						coachSharing,
						updatedAt: new Date(),
					},
				},
			},
		);

		if (!wearableSync) {
			await purgeWearableDataForUser(userId);
		}

		res.status(200).json({
			success: true,
			data: { wearableSync, coachSharing, eligible },
		});
	} catch (error) {
		next(error);
	}
};

/** Shared guard for writes: consent and age, enforced server-side. */
const assertMayStore = async (
	userId: string,
	res: Response,
): Promise<boolean> => {
	const user = await loadConsentSubject(userId);
	if (!user) {
		res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
		return false;
	}
	const decision = mayStoreWearableData(user);
	if (!decision.allowed) {
		res.status(403).json({
			error: CONSENT_ERRORS[decision.reason],
			code: "CONSENT_REQUIRED",
			reason: decision.reason,
		});
		return false;
	}
	return true;
};

/** GET /connections */
export const getConnections: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;
	try {
		res
			.status(200)
			.json({ success: true, data: await listConnections(userId) });
	} catch (error) {
		next(error);
	}
};

/** POST /connections — record that the member connected a health store. */
export const connectWearable: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;

	const parsed = connectWearableSchema.safeParse(req.body);
	if (!parsed.success) {
		validationError(res, parsed.error.issues);
		return;
	}

	try {
		if (!(await assertMayStore(userId, res))) return;
		const doc = await connectSource(
			userId,
			parsed.data.source,
			parsed.data.grantedTypes,
		);
		res.status(200).json({ success: true, data: doc });
	} catch (error) {
		next(error);
	}
};

/** DELETE /connections/:source — disconnect and delete that source's data. */
export const disconnectWearable: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;

	const source = req.params.source;
	if (!Object.values(WearableSource).includes(source as WearableSource)) {
		res.status(400).json({ error: "Unknown source", code: "BAD_REQUEST" });
		return;
	}

	try {
		await disconnectSource(userId, source as WearableSource);
		res
			.status(200)
			.json({ success: true, message: "Disconnected and data deleted" });
	} catch (error) {
		next(error);
	}
};

/** POST /sync — a batch of daily metrics and sleep nights from one source. */
export const syncWearable: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;

	const parsed = syncWearableSchema.safeParse(req.body);
	if (!parsed.success) {
		validationError(res, parsed.error.issues);
		return;
	}

	try {
		if (!(await assertMayStore(userId, res))) return;
		const result = await syncWearableData(userId, parsed.data);
		res.status(200).json({ success: true, data: result });
	} catch (error) {
		next(error);
	}
};

/** GET /daily — own series. */
export const getMyWearableSeries: RequestHandler = async (req, res, next) => {
	const userId = requireMember(req, res);
	if (!userId) return;

	const parsed = wearableRangeQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		validationError(res, parsed.error.issues);
		return;
	}

	try {
		const { from, to, days } = parsed.data;
		res.status(200).json({
			success: true,
			data: await getWearableSeries(userId, from, to, days),
		});
	} catch (error) {
		next(error);
	}
};

/**
 * GET /members/:userId/daily — staff view.
 *
 * Two independent checks, both required:
 *  - the member turned on coach sharing (consent), and
 *  - the requester is their coach (trainer/nutritionist roster) or an admin.
 * Front-desk staff are not coaches and never see this.
 */
export const getMemberWearableSeries: RequestHandler = async (
	req,
	res,
	next,
) => {
	if (!req.user) {
		res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
		return;
	}

	const memberId = req.params.userId;
	if (
		typeof memberId !== "string" ||
		!mongoose.Types.ObjectId.isValid(memberId)
	) {
		res.status(400).json({ error: "Invalid member id", code: "BAD_REQUEST" });
		return;
	}

	const parsed = wearableRangeQuerySchema.safeParse(req.query);
	if (!parsed.success) {
		validationError(res, parsed.error.issues);
		return;
	}

	try {
		const role = normalizeRole(req.user.role);
		if (role === "trainer") {
			await assertTrainerOwnsMember(req.user.id, memberId);
		} else if (role === "nutritionist") {
			await assertNutritionistOwnsMember(req.user.id, memberId);
		} else if (role !== "admin") {
			res.status(403).json({ error: "Access denied", code: "FORBIDDEN" });
			return;
		}

		const member = await loadConsentSubject(memberId);
		if (!member) {
			res.status(404).json({ error: "Member not found", code: "NOT_FOUND" });
			return;
		}

		const decision = mayStaffViewWearableData(member);
		if (!decision.allowed) {
			// 200 with sharing:false, not 403: "this member hasn't shared" is a
			// normal state the dashboard renders, not an error.
			res.status(200).json({
				success: true,
				data: { sharing: false, reason: decision.reason, daily: [] },
			});
			return;
		}

		const { from, to, days } = parsed.data;
		const [series, connections] = await Promise.all([
			getWearableSeries(memberId, from, to, days),
			listConnections(memberId),
		]);
		res.status(200).json({
			success: true,
			data: { sharing: true, ...series, connections },
		});
	} catch (error) {
		const name = (error as { name?: string })?.name;
		if (name === "TrainerRosterError" || name === "NutritionistRosterError") {
			res.status(403).json({
				error: "This member is not assigned to you",
				code: "NOT_YOUR_MEMBER",
			});
			return;
		}
		next(error);
	}
};
