import mongoose from "mongoose";
import { MealLogSource, MealLogStatus } from "../../models/Enums";
import NutritionMealLog from "../../models/nutrition-meal-log.model";
import UserNutritionPlan from "../../models/nutrition-plan.model";
import type { MealItemInput } from "../../types/nutrition";
import { computeDayNumber, recomputeDay } from "./nutrition-adherence.service";
import {
	NutritionServiceError,
	normalizeToUtcDate,
	toObjectId,
} from "./nutrition-errors";
import { sumMacros } from "./nutrition-macro.util";
import { resolveItemsToSnapshots } from "./nutrition-snapshot.util";

export type LogMealInput = {
	planId?: string | null;
	logDate?: Date;
	status?: MealLogStatus;
	source?: MealLogSource;
	plannedMealRef?: { dayNumber: number; mealIndex: number } | null;
	notes?: string;
	photoUrls?: string[];
	items: MealItemInput[];
};

const assertPlanOwnedByUser = async (
	planId: mongoose.Types.ObjectId,
	userId: string,
) => {
	const plan = await UserNutritionPlan.findById(planId);
	if (!plan) {
		throw new NutritionServiceError("NOT_FOUND", "Plan not found");
	}
	if (plan.userId.toString() !== userId) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"This plan is not assigned to you",
		);
	}
	return plan;
};

export const logMeal = async (input: LogMealInput, userId: string) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const logDate = normalizeToUtcDate(input.logDate ?? new Date());

	let planObjectId: mongoose.Types.ObjectId | null = null;
	let dayNumber: number | null = null;

	if (input.planId) {
		planObjectId = toObjectId(
			input.planId,
			"NOT_FOUND",
			"Plan not found",
		);
		const plan = await assertPlanOwnedByUser(planObjectId, userId);
		dayNumber = computeDayNumber(
			plan.startDate,
			plan.durationDays,
			logDate,
		);
	}

	const items = await resolveItemsToSnapshots(input.items);
	const totals = sumMacros(items);

	const log = await NutritionMealLog.create({
		userId: userObjectId,
		planId: planObjectId,
		logDate,
		dayNumber,
		plannedMealRef: input.plannedMealRef ?? null,
		status: input.status ?? MealLogStatus.Logged,
		source: input.source ?? MealLogSource.Manual,
		notes: input.notes ?? "",
		photoUrls: input.photoUrls ?? [],
		items,
		totals,
	});

	if (planObjectId) {
		await recomputeDay(userObjectId, planObjectId, logDate);
	}

	return log;
};

export const markMealCompleted = async (
	planId: string,
	dayNumber: number,
	mealIndex: number,
	userId: string,
	date?: Date,
) => {
	const planObjectId = toObjectId(planId, "NOT_FOUND", "Plan not found");
	const plan = await assertPlanOwnedByUser(planObjectId, userId);
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const logDate = normalizeToUtcDate(date ?? new Date());

	const planDay = plan.days.find((d) => d.dayNumber === dayNumber);
	const meal = planDay?.meals?.[mealIndex];
	if (!meal) {
		throw new NutritionServiceError(
			"NOT_FOUND",
			"Prescribed meal not found",
		);
	}

	const items = (meal.items ?? []).map((item) => ({
		foodId: item.foodId,
		foodName: item.foodName,
		quantityG: item.quantityG,
		caloriesKcal: item.caloriesKcal,
		proteinG: item.proteinG,
		carbsG: item.carbsG,
		fatG: item.fatG,
		fiberG: item.fiberG ?? null,
		sugarG: item.sugarG ?? null,
	}));
	const totals = sumMacros(items);

	const log = await NutritionMealLog.findOneAndUpdate(
		{
			userId: userObjectId,
			planId: planObjectId,
			logDate,
			"plannedMealRef.dayNumber": dayNumber,
			"plannedMealRef.mealIndex": mealIndex,
		},
		{
			userId: userObjectId,
			planId: planObjectId,
			logDate,
			dayNumber,
			plannedMealRef: { dayNumber, mealIndex },
			status: MealLogStatus.Logged,
			source: MealLogSource.Manual,
			items,
			totals,
		},
		{ upsert: true, returnDocument: "after", runValidators: true },
	);

	await recomputeDay(userObjectId, planObjectId, logDate);
	return log;
};

const loadOwnLog = async (logId: string, userId: string) => {
	const id = toObjectId(logId, "NOT_FOUND", "Meal log not found");
	const log = await NutritionMealLog.findById(id);
	if (!log) {
		throw new NutritionServiceError("NOT_FOUND", "Meal log not found");
	}
	if (log.userId.toString() !== userId) {
		throw new NutritionServiceError(
			"FORBIDDEN",
			"This meal log is not yours",
		);
	}
	return log;
};

export type UpdateMealLogInput = {
	status?: MealLogStatus;
	notes?: string;
	photoUrls?: string[];
	items?: MealItemInput[];
};

export const updateMealLog = async (
	logId: string,
	patch: UpdateMealLogInput,
	userId: string,
) => {
	const log = await loadOwnLog(logId, userId);

	if (patch.status !== undefined) {
		log.set({ status: patch.status });
	}
	if (patch.notes !== undefined) {
		log.set({ notes: patch.notes });
	}
	if (patch.photoUrls !== undefined) {
		log.set({ photoUrls: patch.photoUrls });
	}
	if (patch.items) {
		const items = await resolveItemsToSnapshots(patch.items);
		log.set({ items, totals: sumMacros(items) });
	}

	await log.save();

	if (log.planId) {
		await recomputeDay(log.userId, log.planId, log.logDate);
	}

	return log;
};

export const deleteMealLog = async (logId: string, userId: string) => {
	const log = await loadOwnLog(logId, userId);
	const { planId, userId: ownerId, logDate } = log;
	await log.deleteOne();

	if (planId) {
		await recomputeDay(ownerId, planId, logDate);
	}
};

export type ListLogsFilters = {
	planId?: string;
	from?: Date;
	to?: Date;
	page?: number;
	limit?: number;
};

export const listLogs = async (
	userId: string,
	filters: ListLogsFilters,
) => {
	const page = Math.max(1, filters.page ?? 1);
	const limit = Math.min(200, Math.max(1, filters.limit ?? 50));

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
		filter.logDate = range;
	}

	const [items, total] = await Promise.all([
		NutritionMealLog.find(filter)
			.sort({ logDate: -1, consumedAt: -1 })
			.skip((page - 1) * limit)
			.limit(limit),
		NutritionMealLog.countDocuments(filter),
	]);

	return { items, total, page, limit };
};
