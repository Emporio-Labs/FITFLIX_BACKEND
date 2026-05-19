import mongoose from "mongoose";
import { NutritionPlanStatus } from "../../models/Enums";
import NutritionHydrationLog from "../../models/nutrition-hydration.model";
import UserNutritionPlan from "../../models/nutrition-plan.model";
import { recomputeDay } from "./nutrition-adherence.service";
import { normalizeToUtcDate, toObjectId } from "./nutrition-errors";

// Keeps the adherence rollup's denormalized hydration in sync. Hydration
// is not plan-scoped, so refresh every active plan for that day.
const refreshActivePlanRollups = async (
	userId: mongoose.Types.ObjectId,
	date: Date,
) => {
	const activePlans = await UserNutritionPlan.find({
		userId,
		status: NutritionPlanStatus.Active,
	}).select("_id");

	for (const plan of activePlans) {
		await recomputeDay(userId, plan._id, date);
	}
};

export const addHydration = async (
	userId: string,
	amountMl: number,
	source?: string,
	date?: Date,
) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const logDate = normalizeToUtcDate(date ?? new Date());

	const doc = await NutritionHydrationLog.findOneAndUpdate(
		{ userId: userObjectId, logDate },
		{
			$inc: { totalMl: amountMl },
			$push: {
				entries: { amountMl, at: new Date(), source: source ?? "Manual" },
			},
			$setOnInsert: { userId: userObjectId, logDate },
		},
		{ upsert: true, returnDocument: "after", runValidators: true },
	);

	await refreshActivePlanRollups(userObjectId, logDate);
	return doc;
};

export const setHydrationGoal = async (
	userId: string,
	goalMl: number,
	date?: Date,
) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const logDate = normalizeToUtcDate(date ?? new Date());

	const doc = await NutritionHydrationLog.findOneAndUpdate(
		{ userId: userObjectId, logDate },
		{
			$set: { goalMl },
			$setOnInsert: { userId: userObjectId, logDate },
		},
		{ upsert: true, returnDocument: "after", runValidators: true },
	);

	await refreshActivePlanRollups(userObjectId, logDate);
	return doc;
};

export const getHydration = async (userId: string, date?: Date) => {
	const userObjectId = toObjectId(userId, "BAD_REQUEST", "Invalid user ID");
	const logDate = normalizeToUtcDate(date ?? new Date());

	return NutritionHydrationLog.findOne({
		userId: userObjectId,
		logDate,
	});
};
