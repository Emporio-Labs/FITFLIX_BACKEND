import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const connectionUrl = process.env.MONGODB_URL;
if (!connectionUrl) {
  console.error("MONGODB_URL not found in environment.");
  process.exit(1);
}

async function run() {
  try {
    console.log("Connecting to database...");
    await mongoose.connect(connectionUrl!);
    console.log("Connected to MongoDB.");

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Database object is not available");
    }

    const collection = db.collection("hpod_metrics");

    // 1. Unset gmailMessageId: null fields so they don't block the new sparse index
    console.log("Cleaning up existing null gmailMessageId fields...");
    const unsetResult = await collection.updateMany(
      { gmailMessageId: null },
      { $unset: { gmailMessageId: "" } }
    );
    console.log(`Unset null values from ${unsetResult.modifiedCount} documents.`);

    // 2. Drop the existing index
    console.log("Checking indexes on hpod_metrics...");
    const indexes = await collection.indexes();
    const indexExists = indexes.some((index) => index.name === "gmailMessageId_1");

    if (indexExists) {
      console.log("Dropping index gmailMessageId_1...");
      await collection.dropIndex("gmailMessageId_1");
      console.log("Successfully dropped index gmailMessageId_1.");
    } else {
      console.log("Index gmailMessageId_1 does not exist, skipping drop.");
    }

    console.log("Re-syncing indexes from Mongoose schema...");
    // Force Mongoose to build the updated schema indexes (which includes unique/sparse for gmailMessageId)
    const { default: HpodMetric } = await import("../src/models/HpodMetric");
    await HpodMetric.createIndexes();
    console.log("Successfully re-created indexes.");

    console.log("Database migration completed successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
}

void run();
