/**
 * Self-cleaning regression + smoke test for the meal-tracker changes:
 * 1. Plan-linked completion path (markMealCompleted -> recomputeDay) still
 *    produces the correct rollup — the non-negotiable regression check from
 *    the implementation plan.
 * 2. New plan-less free-form logging (logMeal with no planId) produces a
 *    rollup with planId: null.
 * 3. The new `scope` filter on listLogs correctly separates the two.
 *
 * Creates a throwaway user/food/plan/logs, verifies, then deletes
 * everything it created — regardless of pass/fail.
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import { Gender, MealType, NutritionFoodSource, NutritionGoal, NutritionPlanStatus } from "../src/models/Enums";
import NutritionAdherenceDaily from "../src/models/nutrition-adherence.model";
import NutritionFood from "../src/models/nutrition-food.model";
import NutritionMealLog from "../src/models/nutrition-meal-log.model";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import User from "../src/models/User";
import { getDailyAdherence } from "../src/services/nutrition/nutrition-adherence.service";
import { listLogs, logMeal, markMealCompleted } from "../src/services/nutrition/nutrition-meal-log.service";
import connectDB from "../src/utils/db";

config();

let failures = 0;
const check = (label: string, cond: boolean) => {
	console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
	if (!cond) failures++;
};

async function main() {
	await connectDB();

	const suffix = Date.now();
	let user: Awaited<ReturnType<typeof User.create>> | undefined;
	let food: Awaited<ReturnType<typeof NutritionFood.create>> | undefined;
	let plan: Awaited<ReturnType<typeof UserNutritionPlan.create>> | undefined;
	const createdMealLogIds: mongoose.Types.ObjectId[] = [];

	try {
		user = await User.create({
			username: `verify_tracker_${suffix}`,
			email: `verify_tracker_${suffix}@fitflix-verify.test`,
			phone: `+9190000${suffix.toString().slice(-5)}`,
			onboarded: true,
			age: 28,
			gender: Gender.Male,
		});

		food = await NutritionFood.create({
			name: `Verify Test Food ${suffix}`,
			source: NutritionFoodSource.System,
			basePer: 100,
			caloriesKcal: 200,
			proteinG: 10,
			carbsG: 20,
			fatG: 5,
		});

		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);

		plan = await UserNutritionPlan.create({
			userId: user._id,
			nutritionistId: user._id,
			name: `Verify Plan ${suffix}`,
			goal: NutritionGoal.Maintenance,
			status: NutritionPlanStatus.Active,
			startDate: today,
			durationDays: 7,
			days: [
				{
					dayNumber: 1,
					meals: [
						{
							mealType: MealType.Breakfast,
							name: "Test Breakfast",
							items: [
								{
									foodId: food._id,
									foodName: food.name,
									quantityG: 150,
									caloriesKcal: 300,
									proteinG: 15,
									carbsG: 30,
									fatG: 7.5,
								},
							],
						},
					],
				},
			],
		});

		// ── Regression: plan-linked completion path (pre-existing behavior) ──
		const completedLog = await markMealCompleted(
			plan._id.toString(),
			1,
			0,
			user._id.toString(),
			today,
		);
		createdMealLogIds.push(completedLog._id);

		const rollup = await getDailyAdherence(
			user._id.toString(),
			plan._id.toString(),
			today,
		);
		check("plan-linked: adherence rollup created", rollup !== null);
		check("plan-linked: plannedMeals=1", rollup?.plannedMeals === 1);
		check("plan-linked: completedMeals=1", rollup?.completedMeals === 1);
		check("plan-linked: mealAdherencePct=100", rollup?.mealAdherencePct === 100);
		check("plan-linked: plannedCaloriesKcal=300", rollup?.plannedCaloriesKcal === 300);
		check(
			"plan-linked: consumedCaloriesKcal=300",
			rollup?.consumedCaloriesKcal === 300,
		);
		check("plan-linked: calorieAdherencePct=100", rollup?.calorieAdherencePct === 100);
		check(
			"plan-linked: rollup.planId matches plan",
			rollup?.planId?.toString() === plan._id.toString(),
		);

		// ── New: plan-less free-form logging ──
		const freeLog = await logMeal(
			{
				items: [
					{
						foodName: "Homemade Poha",
						quantityG: 200,
						caloriesKcal: 250,
						proteinG: 6,
						carbsG: 45,
						fatG: 5,
					},
				],
				mealType: MealType.Breakfast,
				logDate: today,
			},
			user._id.toString(),
		);
		createdMealLogIds.push(freeLog._id);

		const planlessRollup = await getDailyAdherence(
			user._id.toString(),
			null,
			today,
		);
		check(
			"plan-less: adherence rollup created",
			planlessRollup !== null,
		);
		check(
			"plan-less: rollup.planId is null",
			planlessRollup?.planId === null || planlessRollup?.planId === undefined,
		);
		check(
			"plan-less: consumedCaloriesKcal=250",
			planlessRollup?.consumedCaloriesKcal === 250,
		);
		check(
			"plan-less: foodId is null on the free-text item",
			freeLog.items[0]?.foodId == null,
		);

		// ── scope filter on listLogs ──
		const diaryOnly = await listLogs(user._id.toString(), { scope: "diary" });
		check(
			"scope=diary returns only the plan-less log",
			diaryOnly.items.length === 1 && diaryOnly.items[0]?.planId == null,
		);

		const planOnly = await listLogs(user._id.toString(), { scope: "plan" });
		check(
			"scope=plan returns only the plan-linked log",
			planOnly.items.length === 1 && planOnly.items[0]?.planId != null,
		);

		const allLogs = await listLogs(user._id.toString(), {});
		check("scope omitted returns both (back-compat)", allLogs.items.length === 2);
	} finally {
		console.log("\nCleaning up...");
		await NutritionMealLog.deleteMany({ _id: { $in: createdMealLogIds } });
		if (plan) {
			await NutritionAdherenceDaily.deleteMany({ planId: plan._id });
			await UserNutritionPlan.deleteOne({ _id: plan._id });
		}
		if (user) {
			await NutritionAdherenceDaily.deleteMany({
				userId: user._id,
				planId: null,
			});
			await User.deleteOne({ _id: user._id });
		}
		if (food) {
			await NutritionFood.deleteOne({ _id: food._id });
		}
		console.log("Cleanup complete — all temp data removed.");
		await mongoose.disconnect();
	}

	console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
