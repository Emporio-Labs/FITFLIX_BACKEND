/**
 * Self-cleaning regression check for the getMyAdherence single-day backfill
 * fix: a day with zero logged food previously had no materialized
 * NutritionAdherenceDaily row at all (recomputeDay only runs on meal-log
 * mutations), so the Flutter nutrition-summary redesign's "today" query
 * would come back as an empty `days` array with no target to show.
 *
 * Creates a throwaway user + food, verifies:
 * 1. Before any log, a single-day getAdherenceRange query for "today" has
 *    no row (baseline, proves the gap existed).
 * 2. Replicating the controller's new backfill (recomputeDay when from==to)
 *    materializes a row with correct planned targets and zeroed consumed.
 * 3. After logging food and recomputing, consumedCaloriesKcal reflects it.
 *
 * Deletes everything it created, regardless of pass/fail.
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import { Gender, NutritionFoodSource } from "../src/models/Enums";
import NutritionAdherenceDaily from "../src/models/nutrition-adherence.model";
import NutritionFood from "../src/models/nutrition-food.model";
import NutritionMealLog from "../src/models/nutrition-meal-log.model";
import User from "../src/models/User";
import {
	getAdherenceRange,
	recomputeDay,
} from "../src/services/nutrition/nutrition-adherence.service";
import { logMeal } from "../src/services/nutrition/nutrition-meal-log.service";
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
	const createdMealLogIds: mongoose.Types.ObjectId[] = [];

	try {
		user = await User.create({
			username: `verify_adherence_${suffix}`,
			email: `verify_adherence_${suffix}@fitflix-verify.test`,
			phone: `+9190001${suffix.toString().slice(-5)}`,
			onboarded: true,
			age: 28,
			gender: Gender.Male,
		});

		food = await NutritionFood.create({
			name: `Verify Adherence Food ${suffix}`,
			source: NutritionFoodSource.System,
			basePer: 100,
			caloriesKcal: 300,
			proteinG: 15,
			carbsG: 30,
			fatG: 8,
		});

		const today = new Date();
		const userId = user._id.toString();

		// 1. Baseline: no rollup exists yet for a user who's never logged.
		const before = await getAdherenceRange(userId, null, today, today);
		check("baseline: no rollup before any log/backfill", before.length === 0);

		// 2. Replicate the controller's new single-day backfill.
		await recomputeDay(userId, null, today);
		const backfilled = await getAdherenceRange(userId, null, today, today);
		check("backfill materializes exactly one row", backfilled.length === 1);
		check(
			"backfilled row has zero consumed calories",
			backfilled[0]?.consumedCaloriesKcal === 0,
		);
		// Target resolution has no profile/health-markers for this throwaway
		// user, so it degrades to source: "none" / 0 — this just proves the
		// row exists with a defined (not missing) plannedCaloriesKcal field,
		// not that a specific nonzero number was resolved.
		check(
			"backfilled row has a defined plannedCaloriesKcal",
			typeof backfilled[0]?.plannedCaloriesKcal === "number",
		);

		// 3. Log food, recompute, confirm consumed updates.
		const mealLog = await logMeal(
			{
				logDate: today,
				mealType: "Breakfast" as never,
				items: [
					{
						foodId: food._id.toString(),
						quantityG: 100,
					},
				],
			},
			userId,
		);
		createdMealLogIds.push(mealLog._id as mongoose.Types.ObjectId);

		const afterLog = await getAdherenceRange(userId, null, today, today);
		check(
			"after logging, consumedCaloriesKcal reflects the logged food",
			afterLog[0]?.consumedCaloriesKcal === 300,
		);
	} finally {
		if (createdMealLogIds.length) {
			await NutritionMealLog.deleteMany({ _id: { $in: createdMealLogIds } });
		}
		if (user) {
			await NutritionAdherenceDaily.deleteMany({ userId: user._id });
			await User.deleteOne({ _id: user._id });
		}
		if (food) {
			await NutritionFood.deleteOne({ _id: food._id });
		}
		const cleanupCheck = user
			? (await NutritionAdherenceDaily.countDocuments({ userId: user._id })) === 0 &&
				(await User.countDocuments({ _id: user._id })) === 0
			: true;
		check("cleanup: no leftover documents", cleanupCheck);

		console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
		await mongoose.disconnect();
		process.exit(failures === 0 ? 0 : 1);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
