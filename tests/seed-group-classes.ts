import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import mongoose from "mongoose";
import Class from "../src/models/Class";
import connectDB from "../src/utils/db";

config();

async function main() {
  console.log("=== Seeding Group Classes to MongoDB ===");

  try {
    await connectDB();
    console.log("Connected to MongoDB database.");
  } catch (err) {
    console.error("DB connection failed", err);
    process.exit(1);
  }

  const classesToSeed = [
    {
      _id: randomUUID(),
      name: "Morning Yoga Flow",
      description: "Wake up and flow with this energizing morning yoga session.",
      creditCost: 2,
      status: "ACTIVE",
    },
    {
      _id: randomUUID(),
      name: "High Intensity Cycling",
      description: "Cardio workout to boost endurance and burn calories.",
      creditCost: 3,
      status: "ACTIVE",
    },
    {
      _id: randomUUID(),
      name: "Zumba Dance Fitness",
      description: "Fun, high-energy dance workout for all fitness levels.",
      creditCost: 2,
      status: "ACTIVE",
    },
    {
      _id: randomUUID(),
      name: "Pilates Core Conditioning",
      description: "Focus on strengthening the core and improving alignment.",
      creditCost: 4,
      status: "INACTIVE",
    }
  ];

  try {
    for (const item of classesToSeed) {
      // Check if a class with the same name already exists
      const exists = await Class.findOne({ name: item.name });
      if (exists) {
        console.log(`Class "${item.name}" already exists. Skipping.`);
      } else {
        await Class.create(item);
        console.log(`Created Class: ${item.name} (${item.status})`);
      }
    }
    console.log("\n🎉 Database seeded successfully! 🎉");
  } catch (err) {
    console.error("Error seeding classes", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from DB.");
  }
}

main().catch(console.error);
