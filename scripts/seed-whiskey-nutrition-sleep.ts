import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import NutritionAdherenceDaily from "../src/models/nutrition-adherence.model";
import SleepLog, { SleepSource } from "../src/models/sleep-log.model";
import { getSleepSeries } from "../src/services/sleep.service";
import { buildUserAnalytics } from "../src/services/analytics.service";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import { NutritionGoal, NutritionPlanStatus } from "../src/models/Enums";

async function main() {
	console.log("=== FITFLIX: Seeding 14 Days Nutrition & Sleep Data for whiskey@gmail.com ===");

	await connectDB();

	const user = await User.findOne({ email: "whiskey@gmail.com" });
	if (!user) {
		console.error("❌ User whiskey@gmail.com not found!");
		process.exit(1);
	}

	const userId = user._id;
	console.log(`✅ Found user whiskey@gmail.com (ID: ${userId.toString()})`);

	// 1. Resolve or Create UserNutritionPlan
	let latestPlan = await UserNutritionPlan.findOne({ userId })
		.sort({ createdAt: -1 });

	if (!latestPlan) {
		console.log("Creating default active UserNutritionPlan for Whiskey...");
		latestPlan = await UserNutritionPlan.create({
			userId,
			nutritionistId: userId,
			name: "High Performance Longevity Fuel",
			goal: NutritionGoal.MuscleGain,
			status: NutritionPlanStatus.Active,
			startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
			targetCaloriesKcal: 2000,
			targetMacros: {
				proteinG: 140,
				carbsG: 200,
				fatG: 55,
			},
		});
		console.log(`✅ Created nutrition plan: ${latestPlan._id.toString()}`);
	} else {
		console.log(`ℹ️ Existing nutrition plan found: ${latestPlan._id.toString()} (${latestPlan.name})`);
	}

	const planId = latestPlan._id;
	const targetCalories = latestPlan.targetCaloriesKcal || 2000;
	const targetProtein = latestPlan.targetMacros?.proteinG || 140;
	const targetCarbs = latestPlan.targetMacros?.carbsG || 200;
	const targetFat = latestPlan.targetMacros?.fatG || 55;

	// 2. Seed 14 Days of Data (from 13 days ago to today)
	console.log("\n📊 Generating 14-day history for Sleep & Nutrition...");

	const today = new Date();

	for (let offset = 13; offset >= 0; offset--) {
		const dayDate = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
		const y = dayDate.getFullYear();
		const m = String(dayDate.getMonth() + 1).padStart(2, "0");
		const d = String(dayDate.getDate()).padStart(2, "0");
		const dateStr = `${y}-${m}-${d}`;
		const utcMidnight = new Date(Date.UTC(y, dayDate.getMonth(), dayDate.getDate()));
		const dayOfWeek = dayDate.getDay(); // 0 is Sunday, 6 is Saturday

		// --- SLEEP LOG SEEDING ---
		let bedHour = 23;
		let bedMin = 15;
		let wakeHour = 7;
		let wakeMin = 10;
		let quality = 84;

		if (dayOfWeek === 0 || dayOfWeek === 6) {
			// Weekend: later sleep, later wake, longer duration (~8.5 hrs)
			bedHour = 23;
			bedMin = 45;
			wakeHour = 8;
			wakeMin = 20;
			quality = 90;
		} else if (offset === 4) {
			// Mid-week short night (~6.3 hrs)
			bedHour = 0;
			bedMin = 30;
			wakeHour = 6;
			wakeMin = 50;
			quality = 74;
		} else if (offset === 8) {
			// Super recovery night (~8.2 hrs)
			bedHour = 22;
			bedMin = 50;
			wakeHour = 7;
			wakeMin = 0;
			quality = 92;
		} else {
			// Typical weekday (~7.7 - 7.9 hrs)
			bedMin += (offset % 3) * 5;
			wakeMin += (offset % 4) * 5;
			quality = 82 + (offset % 7);
		}

		// Bedtime is on previous evening if bedHour >= 12
		const bedDate = new Date(dayDate);
		if (bedHour >= 12) {
			bedDate.setDate(bedDate.getDate() - 1);
		}
		bedDate.setHours(bedHour, bedMin, 0, 0);

		const wakeDate = new Date(dayDate);
		wakeDate.setHours(wakeHour, wakeMin, 0, 0);

		let durationMs = wakeDate.getTime() - bedDate.getTime();
		if (durationMs < 0) durationMs += 24 * 60 * 60 * 1000;
		const durationMinutes = Math.round(durationMs / (60 * 1000));

		await SleepLog.findOneAndUpdate(
			{ userId, date: dateStr },
			{
				$set: {
					userId,
					date: dateStr,
					bedtime: bedDate,
					wakeTime: wakeDate,
					durationMinutes,
					source: SleepSource.Manual,
					qualityScore: quality,
					notes: offset === 4 ? "Late work meeting" : offset === 0 ? "Woke up feeling energized" : undefined,
				},
			},
			{ upsert: true, returnDocument: "after" },
		);

		// --- NUTRITION ADHERENCE SEEDING ---
		let calorieVariance = 0;
		let pVariance = 0;
		let cVariance = 0;
		let fVariance = 0;

		if (dayOfWeek === 6) {
			// Saturday: High carb & energy day
			calorieVariance = 220;
			pVariance = 12;
			cVariance = 35;
			fVariance = 4;
		} else if (dayOfWeek === 0) {
			// Sunday: Light recovery day
			calorieVariance = -180;
			pVariance = -8;
			cVariance = -30;
			fVariance = -6;
		} else if (offset === 3) {
			calorieVariance = 70;
			pVariance = 5;
			cVariance = 10;
			fVariance = 2;
		} else if (offset === 7) {
			calorieVariance = -90;
			pVariance = -5;
			cVariance = -15;
			fVariance = -2;
		} else {
			calorieVariance = (offset % 5 - 2) * 30;
			pVariance = (offset % 3 - 1) * 4;
			cVariance = (offset % 4 - 2) * 6;
			fVariance = (offset % 3 - 1) * 2;
		}

		const consumedCal = Math.max(1200, targetCalories + calorieVariance);
		const consumedProtein = Math.max(80, targetProtein + pVariance);
		const consumedCarbs = Math.max(100, targetCarbs + cVariance);
		const consumedFat = Math.max(30, targetFat + fVariance);
		const hydration = 2600 + (offset % 6) * 120;

		await NutritionAdherenceDaily.findOneAndUpdate(
			{ userId, planId, date: utcMidnight },
			{
				$set: {
					userId,
					planId,
					date: utcMidnight,
					plannedMeals: 4,
					loggedMeals: 4,
					completedMeals: 4,
					plannedCaloriesKcal: targetCalories,
					consumedCaloriesKcal: consumedCal,
					plannedMacros: {
						caloriesKcal: targetCalories,
						proteinG: targetProtein,
						carbsG: targetCarbs,
						fatG: targetFat,
						fiberG: 28,
						sugarG: 35,
					},
					consumedMacros: {
						caloriesKcal: consumedCal,
						proteinG: consumedProtein,
						carbsG: consumedCarbs,
						fatG: consumedFat,
						fiberG: 26,
						sugarG: 32,
					},
					mealAdherencePct: 100,
					calorieAdherencePct: Math.round((consumedCal / targetCalories) * 100),
					proteinAdherencePct: Math.round((consumedProtein / targetProtein) * 100),
					hydrationMl: hydration,
					hydrationGoalMl: 3000,
					computedAt: new Date(),
				},
			},
			{ upsert: true, returnDocument: "after" },
		);

		console.log(
			`  [${dateStr}] Sleep: ${(durationMinutes / 60).toFixed(1)}h (Quality: ${quality}%) | Nutrition: ${consumedCal} kcal (P:${consumedProtein}g, C:${consumedCarbs}g, F:${consumedFat}g)`,
		);
	}

	console.log("\n✅ All 14 days of Sleep and Nutrition records seeded successfully!");

	// 3. Test Service Verification
	console.log("\n🧪 Running Service Verifications...");
	const sleepSeries = await getSleepSeries(userId.toString(), undefined, undefined, 14);
	console.log("💤 Sleep Series Result:");
	console.log(`   - Has Data: ${sleepSeries.hasData}`);
	console.log(`   - Days Logged: ${sleepSeries.daysLogged} / ${sleepSeries.totalDays}`);
	console.log(`   - Avg Duration: ${sleepSeries.avgDurationHours}h (${sleepSeries.avgDurationMinutes}m)`);
	console.log(`   - Avg Bedtime: ${sleepSeries.avgBedtimeTimeStr}`);
	console.log(`   - Avg Wake Time: ${sleepSeries.avgWakeTimeStr}`);

	const analytics = await buildUserAnalytics(userId.toString(), "7d");
	console.log("\n🥗 Analytics Nutrition Result (7d):");
	console.log(`   - Days Logged: ${analytics.nutrition.daysLogged} / ${analytics.nutrition.daysInPeriod}`);
	console.log(`   - Recent Daily Points: ${analytics.nutrition.daily.length} days`);
	if (analytics.nutrition.daily.length > 0) {
		const latest = analytics.nutrition.daily[analytics.nutrition.daily.length - 1];
		if (latest && latest.consumedMacros) {
			console.log(`   - Latest Day (${latest.date}): ${latest.consumedKcal} kcal | P: ${latest.consumedMacros.proteinG}g, C: ${latest.consumedMacros.carbsG}g, F: ${latest.consumedMacros.fatG}g`);
		}
	}

	// 4. Generate Auth Token & Test HTTP Endpoints
	const jwtConfig = getJwtConfig();
	if (jwtConfig) {
		const token = signAuthToken(
			{
				id: userId.toString(),
				email: user.email || "whiskey@gmail.com",
				role: (user as any).role || "user",
			},
			jwtConfig,
		);

		console.log("\n🔑 Test Auth Token for whiskey@gmail.com:");
		console.log(`Bearer ${token.slice(0, 30)}...`);

		// Test live HTTP server if it is listening on port 3000
		try {
			const res = await fetch("http://localhost:3000/sleep/series?days=14", {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res.ok) {
				const json = (await res.json()) as any;
				console.log(`\n🚀 HTTP GET /sleep/series?days=14: Status 200 OK! (Returned ${json.data?.daily?.length} days, avg: ${json.data?.avgDurationHours}h)`);
			} else {
				console.log(`\n⚠️ HTTP GET /sleep/series returned status ${res.status}`);
			}
		} catch {
			console.log("\n(Local HTTP server not reachable on localhost:3000, but service layer verified directly)");
		}

		try {
			const res2 = await fetch("http://localhost:3000/analytics/me?period=7d", {
				headers: { Authorization: `Bearer ${token}` },
			});
			if (res2.ok) {
				const data2 = (await res2.json()) as any;
				console.log(`🚀 HTTP GET /analytics/me?period=7d: Status 200 OK! (Nutrition points: ${data2.nutrition?.daily?.length} days, avg: ${data2.nutrition?.avgDailyKcal} kcal)`);
			} else {
				console.log(`⚠️ HTTP GET /analytics/me returned status ${res2.status}`);
			}
		} catch {
			// silent
		}
	}

	console.log("\n🎉 Verification complete! You can now view the Nutrition Graph and Sleep Graph in the app.");
	process.exit(0);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
