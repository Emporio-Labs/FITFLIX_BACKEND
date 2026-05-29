import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import connectDB from "../src/utils/db";

config();

async function main() {
  try {
    await connectDB();
    console.log("Connected to MongoDB database.");

    const users = await User.find({}, "username email phone onboarded");
    console.log("\n=== USERS IN SYSTEM ===");
    for (const u of users) {
      console.log(`- ID: ${u._id} | User: ${u.username} | Email: ${u.email} | Phone: ${u.phone} | Onboarded: ${u.onboarded}`);
    }

    const plans = await UserNutritionPlan.find({}, "userId name status startDate durationDays");
    console.log("\n=== NUTRITION PLANS ===");
    for (const p of plans) {
      console.log(`- ID: ${p._id} | UserID: ${p.userId} | Plan: ${p.name} | Status: ${p.status} | Duration: ${p.durationDays} days`);
    }
  } catch (err) {
    console.error("Error inspecting database:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

main();
