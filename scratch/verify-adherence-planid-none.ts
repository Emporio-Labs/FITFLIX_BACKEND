/**
 * Self-cleaning regression check for the real bug hit in the field: a
 * member with ANY UserNutritionPlan on record (even old/inactive) got the
 * wrong adherence rollup back from GET /nutrition/my/adherence, because
 * getMyAdherence auto-resolves an omitted planId to the user's latest plan
 * — silently reading/writing that plan's rollup instead of the planId:null
 * rollup their free-form diary log actually lives in. Symptom: the
 * redesigned Nutrition tab showed "0 kcal left" / "0 eaten" right after
 * logging food, while the Food Diary screen (which sums logs directly,
 * bypassing this endpoint) correctly showed the log.
 *
 * Fix: planId=none now forces the plan-less rollup explicitly. This script
 * calls the real getMyAdherence controller (not just the service layer) via
 * a stub req/res, for a user who has both a plan AND a plan-less log, and
 * confirms:
 * 1. Omitting planId (legacy default) resolves to the plan and returns 0
 *    consumed — reproduces the bug as a baseline.
 * 2. planId=none returns the plan-less rollup with the real logged total.
 *
 * Deletes everything it created, regardless of pass/fail.
 */

import { config } from "dotenv";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import {
	Gender,
	NutritionFoodSource,
	NutritionGoal,
	NutritionPlanStatus,
} from "../src/models/Enums";
import { getMyAdherence } from "../src/controllers/nutrition-adherence.controller";
import NutritionAdherenceDaily from "../src/models/nutrition-adherence.model";
import NutritionFood from "../src/models/nutrition-food.model";
import NutritionMealLog from "../src/models/nutrition-meal-log.model";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import User from "../src/models/User";
import { logMeal } from "../src/services/nutrition/nutrition-meal-log.service";
import connectDB from "../src/utils/db";

config();

let failures = 0;
const check = (label: string, cond: boolean) => {
	console.log(`${cond ? "PASS" : "FAIL"} - ${label}`);
	if (!cond) failures++;
};

// Minimal stub matching what the controller reads: req.user, req.query, and
// res.status(...).json(...) capturing the body for assertions.
function makeReqRes(userId: string, query: Record<string, string>) {
	let statusCode = 200;
	let body: unknown;
	const req = {
		user: { id: userId, role: "user" },
		query,
	} as unknown as Request;
	const res = {
		status(code: number) {
			statusCode = code;
			return this;
		},
		json(payload: unknown) {
			body = payload;
			return this;
		},
	} as unknown as Response;
	return {
		req,
		res,
		getStatus: () => statusCode,
		getBody: () => body as { days?: Array<Record<string, unknown>> },
	};
}

async function main() {
	await connectDB();

	const suffix = Date.now();
	let user: Awaited<ReturnType<typeof User.create>> | undefined;
	let food: Awaited<ReturnType<typeof NutritionFood.create>> | undefined;
	let plan: Awaited<ReturnType<typeof UserNutritionPlan.create>> | undefined;
	const createdMealLogIds: mongoose.Types.ObjectId[] = [];

	try {
		user = await User.create({
			username: `verify_planid_${suffix}`,
			email: `verify_planid_${suffix}@fitflix-verify.test`,
			phone: `+9190002${suffix.toString().slice(-5)}`,
			onboarded: true,
			age: 28,
			gender: Gender.Male,
		});

		food = await NutritionFood.create({
			name: `Verify PlanId Food ${suffix}`,
			source: NutritionFoodSource.System,
			basePer: 100,
			caloriesKcal: 250,
			proteinG: 12,
			carbsG: 25,
			fatG: 6,
		});

		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);

		// The user HAS a plan on record — this is what triggers the bug via
		// getMyAdherence's "no planId given -> resolve latest plan" default.
		plan = await UserNutritionPlan.create({
			userId: user._id,
			nutritionistId: user._id,
			name: `Verify Plan ${suffix}`,
			goal: NutritionGoal.Maintenance,
			status: NutritionPlanStatus.Active,
			startDate: today,
			durationDays: 7,
			days: [],
		});

		// Free-form diary log — no planId, exactly what the Flutter food
		// diary sends.
		const userId = user._id.toString();
		const mealLog = await logMeal(
			{
				logDate: today,
				mealType: "Breakfast" as never,
				items: [{ foodId: food._id.toString(), quantityG: 100 }],
			},
			userId,
		);
		createdMealLogIds.push(mealLog._id as mongoose.Types.ObjectId);

		const dateStr = today.toISOString().slice(0, 10);

		// 1. Baseline: omitting planId reproduces the bug.
		const buggy = makeReqRes(userId, { from: dateStr, to: dateStr });
		await getMyAdherence(buggy.req, buggy.res, () => {});
		const buggyDay = buggy.getBody()?.days?.[0];
		check(
			"baseline (no planId): resolves to the plan, shows 0 consumed (the bug)",
			buggyDay !== undefined && buggyDay.consumedCaloriesKcal === 0,
		);
		check(
			"baseline (no planId): rollup is keyed to the plan, not plan-less",
			buggyDay !== undefined && buggyDay.planId?.toString() === plan._id.toString(),
		);

		// 2. Fix: planId=none forces the plan-less rollup with the real total.
		const fixed = makeReqRes(userId, {
			from: dateStr,
			to: dateStr,
			planId: "none",
		});
		await getMyAdherence(fixed.req, fixed.res, () => {});
		const fixedDay = fixed.getBody()?.days?.[0];
		check(
			"planId=none: returns the plan-less rollup",
			fixedDay !== undefined && fixedDay.planId === null,
		);
		check(
			"planId=none: consumedCaloriesKcal reflects the actual logged food",
			fixedDay !== undefined && fixedDay.consumedCaloriesKcal === 250,
		);
	} finally {
		if (createdMealLogIds.length) {
			await NutritionMealLog.deleteMany({ _id: { $in: createdMealLogIds } });
		}
		if (plan) {
			await UserNutritionPlan.deleteOne({ _id: plan._id });
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
