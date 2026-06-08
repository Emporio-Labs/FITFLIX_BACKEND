import { config } from "dotenv";
import mongoose from "mongoose";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import NutritionMealLog from "../src/models/nutrition-meal-log.model";
import NutritionProgress from "../src/models/nutrition-progress.model";
import NutritionHydrationLog from "../src/models/nutrition-hydration.model";
import { listMyMealLogs } from "../src/controllers/nutrition-meal-log.controller";
import { listMyProgress } from "../src/controllers/nutrition-progress.controller";
import { getMyHydration } from "../src/controllers/nutrition-hydration.controller";
import { listManagedPlans } from "../src/controllers/nutrition-plan.controller";
import { Gender } from "../src/models/Enums";
import type { Request, Response } from "express";

config();

async function runTest() {
	try {
		console.log("Connecting to Database...");
		await connectDB();
		console.log("Connected.");

		// 1. Fetch or create a staff user (nutritionist / admin)
		let staff = await User.findOne({ email: "temp_nutri@fitflix.in" });
		if (!staff) {
			console.log("Creating temporary nutritionist...");
			staff = await User.create({
				username: "temp_nutritionist",
				email: "temp_nutri@fitflix.in",
				phone: "+919999999990",
				onboarded: true,
				age: 30,
				gender: Gender.Male,
			});
		}
		console.log(`Staff User: ID=${staff._id}, Email=${staff.email} (mocking role "nutritionist")`);

		// 2. Fetch or create a client/user
		let client = await User.findOne({ email: "temp_client@fitflix.in" });
		if (!client) {
			console.log("Creating temporary client user...");
			client = await User.create({
				username: "temp_client",
				email: "temp_client@fitflix.in",
				phone: "+919999999991",
				onboarded: true,
				age: 25,
				gender: Gender.Female,
			});
		}
		console.log(`Client User: ID=${client._id}, Email=${client.email} (mocking role "user")`);

		// 3. Setup test data for client
		const plan = await UserNutritionPlan.findOneAndUpdate(
			{ userId: client._id },
			{
				$setOnInsert: {
					userId: client._id,
					name: "Test Active Plan",
					status: "Active",
					startDate: new Date(),
					durationDays: 30,
					days: [{ dayNumber: 1, meals: [] }],
				},
			},
			{ upsert: true, returnDocument: "after" },
		);
		console.log(`User Plan: ID=${plan._id}, Name=${plan.name}, Status=${plan.status}`);

		// Create a meal log entry
		const todayStr = new Date().toISOString().slice(0, 10);
		const mealLog = await NutritionMealLog.findOneAndUpdate(
			{ userId: client._id, logDate: new Date(todayStr) },
			{
				$setOnInsert: {
					userId: client._id,
					planId: plan._id,
					logDate: new Date(todayStr),
					status: "logged",
					source: "Manual",
					items: [
						{
							foodName: "Apple",
							quantityG: 100,
							caloriesKcal: 52,
							proteinG: 0.3,
							carbsG: 14,
							fatG: 0.2,
						},
					],
					totals: {
						caloriesKcal: 52,
						proteinG: 0.3,
						carbsG: 14,
						fatG: 0.2,
					},
				},
			},
			{ upsert: true, returnDocument: "after" },
		);
		console.log(`Meal Log: ID=${mealLog._id}, Date=${mealLog.logDate.toISOString()}`);

		// Create a progress entry
		const progressEntry = await NutritionProgress.findOneAndUpdate(
			{ userId: client._id, recordedAt: new Date(todayStr) },
			{
				$setOnInsert: {
					userId: client._id,
					recordedAt: new Date(todayStr),
					weightKg: 70,
					bodyFatPct: 15,
					recordedBy: "User",
				},
			},
			{ upsert: true, returnDocument: "after" },
		);
		console.log(`Progress: ID=${progressEntry._id}, Weight=${progressEntry.weightKg}kg`);

		// Create a hydration entry
		const hydrationLog = await NutritionHydrationLog.findOneAndUpdate(
			{ userId: client._id, logDate: new Date(todayStr) },
			{
				$setOnInsert: {
					userId: client._id,
					logDate: new Date(todayStr),
					goalMl: 2000,
					totalMl: 500,
					entries: [{ amountMl: 500, source: "Manual", at: new Date() }],
				},
			},
			{ upsert: true, returnDocument: "after" },
		);
		console.log(`Hydration: ID=${hydrationLog._id}, Total=${hydrationLog.totalMl}ml`);

		// 4. Test listMyMealLogs (Staff calling for Client)
		console.log("\n--- Testing listMyMealLogs for Staff ---");
		const mealLogReq = {
			user: { id: staff._id.toString(), role: "nutritionist" },
			query: { userId: client._id.toString(), planId: plan._id.toString() },
		} as unknown as Request;

		let responseJson: any = null;
		const mockRes = {
			status: (code: number) => {
				console.log(`Response Status: ${code}`);
				return mockRes;
			},
			json: (data: any) => {
				responseJson = data;
				return mockRes;
			},
		} as unknown as Response;

		await listMyMealLogs(mealLogReq, mockRes, (err) => console.error(err));
		console.log("Response JSON:", responseJson);
		if (responseJson && responseJson.items && responseJson.items.length > 0) {
			console.log("✅ Success: Staff listed user meal logs successfully!");
			console.log(`- Logs count: ${responseJson.items.length}`);
			console.log(`- Item User ID: ${responseJson.items[0].userId}`);
		} else {
			console.log("❌ Failed: Meal logs not loaded correctly.");
		}

		// 5. Test listMyProgress (Staff calling for Client)
		console.log("\n--- Testing listMyProgress for Staff ---");
		const progressReq = {
			user: { id: staff._id.toString(), role: "nutritionist" },
			query: { userId: client._id.toString() },
		} as unknown as Request;

		responseJson = null;
		await listMyProgress(progressReq, mockRes, (err) => console.error(err));
		console.log("Response JSON:", responseJson);
		if (responseJson && responseJson.items && responseJson.entries) {
			console.log("✅ Success: Staff listed user progress entries!");
			console.log(`- Entries count: ${responseJson.entries.length}`);
			console.log(`- Items count: ${responseJson.items.length}`);
			if (responseJson.items.length > 0) {
				console.log(`- First Item: Date=${responseJson.items[0].date}, Weight=${responseJson.items[0].weight}kg`);
			}
		} else {
			console.log("❌ Failed: Progress entries or items missing.");
		}

		// 6. Test getMyHydration (Staff calling for Client)
		console.log("\n--- Testing getMyHydration for Staff ---");
		const hydrationReq = {
			user: { id: staff._id.toString(), role: "nutritionist" },
			query: { userId: client._id.toString(), date: todayStr },
		} as unknown as Request;

		responseJson = null;
		await getMyHydration(hydrationReq, mockRes, (err) => console.error(err));
		console.log("Response JSON:", responseJson);
		if (responseJson && responseJson.hydration && responseJson.items) {
			console.log("✅ Success: Staff listed user hydration entries!");
			console.log(`- Goal: ${responseJson.hydration.goalMl}ml, Total: ${responseJson.hydration.totalMl}ml`);
			console.log(`- Items array:`, responseJson.items);
		} else {
			console.log("❌ Failed: Hydration log or items missing.");
		}

		// 7. Test listManagedPlans (A DIFFERENT staff member calling for Client)
		console.log("\n--- Testing listManagedPlans for Different Staff ---");
		const differentStaffId = new mongoose.Types.ObjectId().toString(); // Random nutritionist ID
		const planReq = {
			user: { id: differentStaffId, role: "nutritionist" },
			query: { userId: client._id.toString() },
		} as unknown as Request;

		responseJson = null;
		await listManagedPlans(planReq, mockRes, (err) => console.error(err));
		console.log("Response JSON:", responseJson);
		if (responseJson && responseJson.plans && responseJson.plans.length > 0) {
			console.log("✅ Success: Different staff listed user active plans successfully!");
			console.log(`- Plans count: ${responseJson.plans.length}`);
			console.log(`- Plan Name: ${responseJson.plans[0].name}`);
			console.log(`- Plan User ID: ${responseJson.plans[0].userId}`);
		} else {
			console.log("❌ Failed: Could not retrieve plans from different nutritionist.");
		}

	} catch (error) {
		console.error("Test execution failed:", error);
	} finally {
		await mongoose.disconnect();
		console.log("\nDisconnected from Database.");
	}
}

runTest();
