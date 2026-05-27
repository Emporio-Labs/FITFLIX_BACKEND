import { ProgressRecordedBy } from "../../models/Enums";
import NutritionProgress from "../../models/nutrition-progress.model";
import type { NutritionActor } from "../../types/nutrition";
import { getPlan } from "./nutrition-assignment.service";
import { normalizeToUtcDate, toObjectId } from "./nutrition-errors";

export type ProgressInput = {
	planId?: string | null;
	recordedAt?: Date;
	weightKg?: number | null;
	bodyFatPct?: number | null;
	measurements?: {
		chestCm?: number | null;
		waistCm?: number | null;
		hipCm?: number | null;
		armCm?: number | null;
		thighCm?: number | null;
	};
	photoUrls?: string[];
	note?: string;
};

export type ProgressListFilters = {
	planId?: string;
	from?: Date;
	to?: Date;
};

export const addProgressEntry = async (
	input: ProgressInput,
	userId: string,
	recordedBy: ProgressRecordedBy,
) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");

	return NutritionProgress.create({
		userId: userObjectId,
		planId: input.planId
			? toObjectId(input.planId, "BAD_REQUEST", "Invalid plan ID")
			: null,
		recordedAt: input.recordedAt ?? new Date(),
		weightKg: input.weightKg ?? null,
		bodyFatPct: input.bodyFatPct ?? null,
		measurements: input.measurements ?? {},
		photoUrls: input.photoUrls ?? [],
		note: input.note ?? "",
		recordedBy,
	});
};

export const listProgress = async (
	userId: string,
	filters: ProgressListFilters,
) => {
	const filter: Record<string, unknown> = {
		userId: toObjectId(userId, "BAD_REQUEST", "Invalid user ID"),
	};

	if (filters.planId) {
		filter.planId = toObjectId(
			filters.planId,
			"BAD_REQUEST",
			"Invalid plan ID",
		);
	}

	if (filters.from || filters.to) {
		const range: Record<string, Date> = {};
		if (filters.from) {
			range.$gte = normalizeToUtcDate(filters.from);
		}
		if (filters.to) {
			range.$lte = normalizeToUtcDate(filters.to);
		}
		filter.recordedAt = range;
	}

	return NutritionProgress.find(filter).sort({ recordedAt: -1 });
};

// Plan-scoped read for the assigning nutritionist (auth via getPlan).
export const getPlanProgress = async (
	planId: string,
	actor: NutritionActor,
) => {
	const plan = await getPlan(planId, actor);
	return NutritionProgress.find({ planId: plan._id }).sort({
		recordedAt: -1,
	});
};

// Nutritionist records progress on behalf of the plan's user.
export const addPlanProgress = async (
	planId: string,
	input: ProgressInput,
	actor: NutritionActor,
) => {
	const plan = await getPlan(planId, actor);
	return addProgressEntry(
		{ ...input, planId: plan._id.toString() },
		plan.userId.toString(),
		ProgressRecordedBy.Nutritionist,
	);
};
