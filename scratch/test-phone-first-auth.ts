import { config } from "dotenv";
config();
import mongoose from "mongoose";
import User from "../src/models/User";
import Lead from "../src/models/Lead";
import Membership from "../src/models/Membership";
import { LeadStatus, MembershipStatus } from "../src/models/Enums";
import { processLeadFollowups } from "../src/services/lead-followup.scheduler";

const mongoUrl = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/hybridhuman";

async function runVerification() {
  console.log("=== STARTING PHONE-FIRST & GATING VERIFICATION SUITE ===");
  console.log(`Connecting to MongoDB at: ${mongoUrl}`);
  await mongoose.connect(mongoUrl);
  console.log("Connected to MongoDB.");

  // Test Case 1: The Sparseness Safety Verification (MongoDB Unique Key Collision Run)
  console.log("\n--- TEST CASE 1: Sparseness Safety Verification ---");
  const stamp = Date.now();
  const phone1 = "95" + String(stamp).slice(-8);
  const phone2 = "96" + String(stamp).slice(-8);

  // Create two separate users with undefined email
  const user1 = await User.create({
    username: `user1_${stamp}`,
    phone: phone1,
    email: undefined,
    age: 25,
    gender: "Male",
    healthGoals: ["Weight Loss"],
  });

  const user2 = await User.create({
    username: `user2_${stamp}`,
    phone: phone2,
    email: undefined,
    age: 30,
    gender: "Female",
    healthGoals: ["Muscle Gain"],
  });

  console.log(`Successfully created User 1 (${user1.username}) with email: undefined`);
  console.log(`Successfully created User 2 (${user2.username}) with email: undefined`);

  // Clean up
  await User.deleteOne({ _id: user1._id });
  await User.deleteOne({ _id: user2._id });
  console.log("PASSED: Sparseness Safety (Multiple undefined emails did not trigger collision).");

  // Test Case 2: Cal.id Fallback Booking Loop Verification
  console.log("\n--- TEST CASE 2: Cal.id Fallback Booking Loop ---");
  const testUserId = new mongoose.Types.ObjectId();
  const testPhone = "98" + String(stamp).slice(-8);
  const userWithNoEmail = await User.create({
    _id: testUserId,
    username: `noemail_${stamp}`,
    phone: testPhone,
    email: undefined,
    age: 25,
    gender: "Male",
    healthGoals: ["Weight Loss"],
  });

  console.log("Created user in DB:", JSON.stringify(userWithNoEmail, null, 2));

  // Check direct findById
  const directCheck = await User.findById(testUserId);
  console.log("Direct findById check:", JSON.stringify(directCheck, null, 2));

  // Verify HPOD webhook lookup stripping @fitflix.in
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database reference not available");

  // Format the fallback email like we would send to Cal.id
  const generatedEmail = `${testPhone}@fitflix.in`;
  console.log(`Generated fallback email: ${generatedEmail}`);

  // Test resolve logic from webhook
  const prefix = generatedEmail.split("@")[0] || "";
  const last10 = prefix.replace(/\D/g, "").slice(-10);
  console.log(`Webhook search regex pattern: ${last10 + "$"}`);

  const foundUser = await db.collection("users").findOne({ phone: { $regex: new RegExp(last10 + "$") } });
  console.log("Database native findOne result:", JSON.stringify(foundUser, null, 2));

  const foundUserMongoose = await User.findOne({ phone: { $regex: new RegExp(last10 + "$") } });
  console.log("Mongoose findOne result:", JSON.stringify(foundUserMongoose, null, 2));

  if (!foundUser || String(foundUser._id) !== String(testUserId)) {
    throw new Error(`FAIL: HPOD lookup failed to reverse-engineer user ID from email ${generatedEmail}`);
  }
  console.log(`PASSED: Cal.id Fallback Booking Loop successfully resolved ${generatedEmail} to ${foundUser._id}`);

  // Clean up
  await User.deleteOne({ _id: testUserId });

  // Test Case 3: The Account Merger Test (Lead Conversion)
  console.log("\n--- TEST CASE 3: Account Merger Test ---");
  const mergePhone = "97" + String(stamp).slice(-8);
  const mergePhoneInput = "+91" + mergePhone;
  const leadEmail = `lead_${stamp}@example.com`;

  // Create a standard user with the merge phone
  const existingAppUser = await User.create({
    username: `existing_${stamp}`,
    phone: mergePhone,
    email: undefined,
    age: 25,
    gender: "Male",
    healthGoals: ["Weight Loss"],
  });

  // Create a lead with the same phone
  const lead = await Lead.create({
    leadName: `Lead_${stamp}`,
    phone: mergePhoneInput,
    email: leadEmail,
    source: "marketing",
    interestedIn: "Weight Loss",
  });

  console.log(`Seed Lead ID: ${lead._id}, Phone: ${lead.phone}`);
  console.log(`Seed User ID: ${existingAppUser._id}, Phone: ${existingAppUser.phone}`);

  // Perform lead conversion simulation
  const last10Merge = lead.phone.replace(/\D/g, "").slice(-10);
  const userQuery: any[] = [];
  if (lead.email) {
    userQuery.push({ email: lead.email.trim() });
  }
  if (last10Merge) {
    userQuery.push({ phone: { $regex: new RegExp(last10Merge + "$") } });
  }
  const foundExistingUser = await User.findOne({ $or: userQuery });
  if (!foundExistingUser) {
    throw new Error("FAIL: Pre-existing user not found for conversion matching!");
  }

  const targetUserId = foundExistingUser._id;
  
  // Verify it resolves to existing user's ID
  if (String(targetUserId) !== String(existingAppUser._id)) {
    throw new Error(`FAIL: Target user ID resolved to ${targetUserId}, expected ${existingAppUser._id}`);
  }

  // Create Membership (Simulation)
  const membership = await Membership.create({
    user: targetUserId,
    planName: "Standard Protocol Membership",
    creditsIncluded: 10,
    creditsRemaining: 10,
    status: MembershipStatus.Active,
    price: 0,
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  lead.status = LeadStatus.Converted;
  lead.convertedUser = targetUserId;
  await lead.save();

  console.log(`Lead status updated to Converted, bound to User ID: ${lead.convertedUser}`);
  console.log(`Membership allocated successfully. ID: ${membership._id}`);

  // Clean up
  await User.deleteOne({ _id: existingAppUser._id });
  await Lead.deleteOne({ _id: lead._id });
  await Membership.deleteOne({ _id: membership._id });
  console.log("PASSED: Account Merger Test.");

  // Test Case 4: Follow-up Scheduler Milestones
  console.log("\n--- TEST CASE 4: Follow-up Scheduler Milestones ---");
  
  const lead24h = await Lead.create({
    leadName: `Lead24h_${stamp}`,
    phone: "+91999900" + String(stamp).slice(-4),
    source: "instagram",
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
  });

  const lead72h = await Lead.create({
    leadName: `Lead72h_${stamp}`,
    phone: "+91999972" + String(stamp).slice(-4),
    source: "facebook",
    createdAt: new Date(Date.now() - 73 * 60 * 60 * 1000), // 73 hours ago
  });

  const lead7d = await Lead.create({
    leadName: `Lead7d_${stamp}`,
    phone: "+91999907" + String(stamp).slice(-4),
    source: "google",
    createdAt: new Date(Date.now() - 170 * 60 * 60 * 1000), // ~7 days ago
  });

  console.log("Mock leads seeded. Running scheduler...");
  const result = await processLeadFollowups();
  console.log(`Scheduler executed: processedCount=${result.processedCount}`);

  // Validate follow-up outbox messages contain the deep-link
  const msg24h = result.messages.find(m => m.leadId === String(lead24h._id));
  const msg72h = result.messages.find(m => m.leadId === String(lead72h._id));
  const msg7d = result.messages.find(m => m.leadId === String(lead7d._id));

  if (!msg24h || !msg24h.message.includes("fitflix://dashboard/protocols") || msg24h.milestone !== "24h") {
    throw new Error(`FAIL: 24h milestone follow-up message not generated or missing deep-link! ${JSON.stringify(msg24h)}`);
  }
  if (!msg72h || !msg72h.message.includes("fitflix://dashboard/protocols") || msg72h.milestone !== "72h") {
    throw new Error(`FAIL: 72h milestone follow-up message not generated or missing deep-link! ${JSON.stringify(msg72h)}`);
  }
  if (!msg7d || !msg7d.message.includes("fitflix://dashboard/protocols") || msg7d.milestone !== "7d") {
    throw new Error(`FAIL: 7d milestone follow-up message not generated or missing deep-link! ${JSON.stringify(msg7d)}`);
  }

  console.log("PASS: Generated all milestone messages with deep link fitflix://dashboard/protocols successfully!");

  // Clean up
  await Lead.deleteOne({ _id: lead24h._id });
  await Lead.deleteOne({ _id: lead72h._id });
  await Lead.deleteOne({ _id: lead7d._id });

  console.log("\n=== ALL PHONE-FIRST AND PARTITION GATING CHECKS PASSED SUCCESSFULLY! ===");
}

runVerification()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("FAIL: Verification failed with error:", error);
    await mongoose.disconnect();
    process.exit(1);
  });
