import mongoose from "mongoose";
import dotenv from "dotenv";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import User from "../src/models/User";

dotenv.config();

const MONGODB_URL = process.env.MONGODB_URL;
if (!MONGODB_URL) {
  console.error("MONGODB_URL is not set in environment");
  process.exit(1);
}

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URL);
    console.log("Connected successfully.");

    const rahul = await User.findOne({ email: "rahul@fitflix.in" });
    if (!rahul) {
      console.error("Rahul user not found in DB");
      return;
    }

    console.log(`\nFound User: ${rahul.username} (${rahul.email}), ID: ${rahul._id}`);

    const jwtConfig = getJwtConfig();
    if (!jwtConfig) {
      console.error("JWT config is not loaded!");
      return;
    }

    const payload = {
      id: rahul._id.toString(),
      email: rahul.email ?? "",
      role: "user" as const,
    };

    console.log("Signing token with payload:", payload);
    const token = signAuthToken(payload, jwtConfig);
    console.log("\nGenerated Token:", token);

    // Call the local API /api/v1/classes/schedule using fetch with this token
    console.log("\nQuerying local API /api/v1/classes/schedule...");
    const response = await fetch("http://localhost:3000/api/v1/classes/schedule", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    const data = await response.json();
    console.log("Response Body:", JSON.stringify(data, null, 2));

  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from DB.");
  }
}

run();
