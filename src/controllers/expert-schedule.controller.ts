import type { RequestHandler } from "express";
import mongoose from "mongoose";
import { ExpertType } from "../models/Enums";
import { normalizeRole } from "../middleware/rbac.middleware";
import {
	calculatePooledAvailability,
	getOrCreateExpertSchedule,
	resolveExpertsOfType,
	updateExpertSchedule,
} from "../services/expert-schedule.service";
import { normalizeSupportedModes } from "../utils/appointment-mode";
import { resolveBookingTimeContext } from "../utils/location.resolver";
import {
	pooledAvailabilityQuerySchema,
	updateExpertScheduleSchema,
} from "../validators/expert-schedule.validator";

/**
 * The expert-schedule surface, generalised from the trainer-only routes.
 *
 * Everything here is expert-type-agnostic: the same handlers serve trainers,
 * nutritionists and sports scientists. Personal training keeps its own
 * `/pt/trainers/...` paths for backward compatibility; they now delegate to
 * the same service.
 */

const parseExpertType = (raw: unknown): ExpertType | null => {
	if (typeof raw !== "string") return null;
	const normalized = raw.trim().toLowerCase();
	const match = (Object.values(ExpertType) as string[]).find(
		(v) => v === normalized,
	);
	return (match as ExpertType) ?? null;
};

/**
 * The role string a token carries for a given expert type. `sports_scientist`
 * and `nutritionist` are `staffRole` values issued at login; trainers get
 * "trainer" from their own collection.
 */
const roleForExpertType = (expertType: ExpertType): string => expertType;

/**
 * A non-admin may only touch their own schedule. Admin and frontdesk may touch
 * anyone's — they are the ones who set a schedule up before the expert has
 * ever logged in.
 */
const canEditSchedule = (
	requester: { id: string; role: string } | undefined,
	expertId: string,
	expertType: ExpertType,
): boolean => {
	if (!requester) return false;
	const role = normalizeRole(requester.role as never);
	if (role === "admin" || role === "frontdesk") return true;
	if (role !== roleForExpertType(expertType)) return false;
	return String(requester.id) === String(expertId);
};

export const getExpertDirectory: RequestHandler = async (req, res, next) => {
	try {
		const expertType = parseExpertType(req.params.expertType);
		if (!expertType) {
			res.status(400).json({
				error: `expertType must be one of ${Object.values(ExpertType).join(", ")}`,
				code: "BAD_REQUEST",
			});
			return;
		}

		const experts = await resolveExpertsOfType(expertType);
		res.status(200).json({ expertType, experts });
	} catch (error) {
		next(error);
	}
};

/**
 * Pooled availability across every active expert of a type.
 *
 * This is what the member app calls instead of `/slots/available`. With one
 * nutritionist it returns exactly that nutritionist's windows; with five it
 * returns their union, each time carrying who is free then.
 */
export const getPooledAvailability: RequestHandler = async (req, res, next) => {
	try {
		const expertType = parseExpertType(req.params.expertType);
		if (!expertType) {
			res.status(400).json({
				error: `expertType must be one of ${Object.values(ExpertType).join(", ")}`,
				code: "BAD_REQUEST",
			});
			return;
		}

		const parsed = pooledAvailabilityQuerySchema.safeParse(req.query);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.format(),
			});
			return;
		}

		const { date, mode, timeZone } = parsed.data;
		const result = await calculatePooledAvailability({
			expertType,
			date,
			mode,
			timeZone,
		});

		res.status(200).json({
			expertType,
			date: date.slice(0, 10),
			mode: mode ?? null,
			timeZone: result.timeZone,
			// The client's date picker clamps to this instead of guessing 60.
			maxAdvanceBookingDays: result.maxAdvanceBookingDays,
			experts: result.experts,
			slots: result.slots,
		});
	} catch (error) {
		next(error);
	}
};

const resolveScheduleTarget = (
	req: Parameters<RequestHandler>[0],
): { expertId: string; expertType: ExpertType } | { error: string } => {
	const expertType = parseExpertType(req.params.expertType);
	if (!expertType) {
		return {
			error: `expertType must be one of ${Object.values(ExpertType).join(", ")}`,
		};
	}

	const raw = req.params.expertId;
	// "/me" resolves to the caller, so an expert never has to know their own id.
	const expertId = raw === "me" ? req.user?.id : raw;
	if (!expertId || !mongoose.Types.ObjectId.isValid(String(expertId))) {
		return { error: "Invalid expert ID" };
	}

	return { expertId: String(expertId), expertType };
};

export const getExpertScheduleHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const target = resolveScheduleTarget(req);
		if ("error" in target) {
			res.status(400).json({ error: target.error, code: "BAD_REQUEST" });
			return;
		}

		const schedule = await getOrCreateExpertSchedule(
			target.expertId,
			target.expertType,
		);
		const { timezone } = await resolveBookingTimeContext(null);

		res.status(200).json({
			schedule: {
				...(schedule.toObject ? schedule.toObject() : schedule),
				// Always echo the canonical two-value form, even for a document
				// written before supportedModes existed.
				supportedModes: normalizeSupportedModes(schedule.supportedModes),
			},
			timeZone: timezone,
		});
	} catch (error) {
		next(error);
	}
};

export const updateExpertScheduleHandler: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const target = resolveScheduleTarget(req);
		if ("error" in target) {
			res.status(400).json({ error: target.error, code: "BAD_REQUEST" });
			return;
		}

		if (
			!canEditSchedule(
				req.user as { id: string; role: string } | undefined,
				target.expertId,
				target.expertType,
			)
		) {
			res.status(403).json({
				error: "Forbidden: you can only edit your own schedule",
				code: "FORBIDDEN",
			});
			return;
		}

		const parsed = updateExpertScheduleSchema.safeParse(req.body ?? {});
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: parsed.error.format(),
			});
			return;
		}

		const schedule = await updateExpertSchedule(
			target.expertId,
			parsed.data,
			target.expertType,
		);

		res.status(200).json({
			message: "Schedule updated successfully",
			schedule: schedule
				? {
						...(schedule.toObject ? schedule.toObject() : schedule),
						supportedModes: normalizeSupportedModes(schedule.supportedModes),
					}
				: null,
		});
	} catch (error: unknown) {
		// updateExpertSchedule throws plain Errors for overlapping shift windows —
		// those are the caller's fault, not a 500.
		const message =
			error instanceof Error ? error.message : "Failed to update schedule";
		if (/shift|window|End time/i.test(message)) {
			res.status(400).json({ error: message, code: "BAD_REQUEST" });
			return;
		}
		next(error);
	}
};
