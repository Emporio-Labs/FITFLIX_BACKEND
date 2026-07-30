import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import mongoose from "mongoose";
import Class from "../src/models/Class";
import connectDB from "../src/utils/db";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";

config();

const PORT = 3544;
const API_BASE = `http://localhost:${PORT}`;

async function main() {
  console.log("=== Testing Update Group Class via API ===");

  // 1. Connect to DB
  try {
    await connectDB();
    console.log("Connected to MongoDB.");
  } catch (err) {
    console.error("DB connection failed", err);
    process.exit(1);
  }

  // 2. Find target class to update or seed it if missing
  let targetClass = await Class.findOne({ name: "Morning Yoga Flow" });
  if (!targetClass) {
    console.log("Class 'Morning Yoga Flow' not found. Seeding it first...");
    targetClass = await Class.create({
      _id: randomUUID(),
      name: "Morning Yoga Flow",
      description: "Wake up and flow with this energizing morning yoga session.",
      creditCost: 2,
      status: "ACTIVE",
    });
  }
  console.log(`Found target class: ID=${targetClass._id}, Name="${targetClass.name}", CreditCost=${targetClass.creditCost}`);

  // 3. Generate admin token
  const jwtConfig = getJwtConfig();
  if (!jwtConfig) {
    console.error("JWT_SECRET is missing.");
    await mongoose.disconnect();
    process.exit(1);
  }
  const adminToken = signAuthToken(
    { id: "test-admin-id", email: "admin@test.com", role: "admin" },
    jwtConfig
  );

  // 4. Spin up the server temporarily on test port
  const { createServer } = await import("node:http");
  const { default: app } = await import("../src/app");
  const server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(PORT, () => {
      console.log(`Temporary test server listening on ${API_BASE}`);
      resolve();
    });
  });

  // 5. Send PUT request to update the class
  const updatedData = {
    name: "Morning Yoga Flow - Level 2",
    description: "An advanced flow session.",
    creditCost: 5,
    status: "ACTIVE"
  };

  try {
    console.log(`\nSending PUT /api/v1/admin/classes/${targetClass._id}...`);
    const res = await fetch(`${API_BASE}/api/v1/admin/classes/${targetClass._id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminToken}`
      },
      body: JSON.stringify(updatedData)
    });

    const body = await res.json();
    console.log(`Response Status: ${res.status}`);
    console.log("Response Body:", JSON.stringify(body, null, 2));

    if (res.status === 200 && body.class.name === updatedData.name && body.class.creditCost === updatedData.creditCost) {
      console.log("\n✅ UPDATE TEST PASSED SUCCESSFULLY! Class was updated successfully.");
    } else {
      console.error("\n❌ UPDATE TEST FAILED.");
    }

  } catch (err) {
    console.error("Error during API request", err);
  } finally {
    // Clean up
    server.close();
    await mongoose.disconnect();
    console.log("\nDisconnected from DB and stopped server.");
  }
}

main().catch(console.error);
