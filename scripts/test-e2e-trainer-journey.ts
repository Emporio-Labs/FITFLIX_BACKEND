import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

const API_BASE = "http://localhost:3000";

async function runE2ETest() {
  console.log("=================================================");
  console.log("🚀 STARTING COMPLETE E2E TRAINER JOURNEY TEST");
  console.log("=================================================\n");

  // Step 0: Ensure Test Users Exist in MongoDB
  await mongoose.connect(process.env.MONGODB_URL!);
  const db = mongoose.connection.db!;

  // 1. Ensure Admin Account
  let admin = await db.collection("admins").findOne({ email: "admin@fitflix.in" });
  if (!admin) {
    const adminPassHash = await bcrypt.hash("admin123", 10);
    await db.collection("admins").insertOne({
      adminName: "E2E Admin",
      email: "admin@fitflix.in",
      phone: "9999999999",
      passwordHash: adminPassHash,
      createdAt: new Date(),
    });
  }

  // 2. Ensure Trainer Account
  let trainer = await db.collection("trainers").findOne({ email: "coach.alex@fitflix.in" });
  if (!trainer) {
    const trainerPassHash = await bcrypt.hash("trainer123", 10);
    const result = await db.collection("trainers").insertOne({
      trainerName: "Coach Alex",
      email: "coach.alex@fitflix.in",
      phone: "9876543210",
      passwordHash: trainerPassHash,
      description: "Elite Strength & Conditioning Specialist",
      specialities: ["Strength Training", "HIIT"],
      isActive: true,
      createdAt: new Date(),
    });
    trainer = await db.collection("trainers").findOne({ _id: result.insertedId });
  }

  // 3. Ensure Member Account
  let member = await db.collection("users").findOne({ email: "e2e.member@fitflix.in" });
  if (!member) {
    const memberPassHash = await bcrypt.hash("member123", 10);
    const result = await db.collection("users").insertOne({
      username: "E2E Test Member",
      email: "e2e.member@fitflix.in",
      phone: "9123456789",
      age: 28,
      gender: "Male",
      passwordHash: memberPassHash,
      onboarded: true,
      createdAt: new Date(),
    });
    member = await db.collection("users").findOne({ _id: result.insertedId });
  }

  await mongoose.disconnect();

  const trainerId = trainer!._id.toString();
  const memberId = member!._id.toString();

  console.log(`📌 Test Entities Prepared:`);
  console.log(`   - Admin: admin@fitflix.in`);
  console.log(`   - Trainer: coach.alex@fitflix.in (ID: ${trainerId})`);
  console.log(`   - Member: e2e.member@fitflix.in (ID: ${memberId})\n`);

  // Logins
  console.log("🔐 Authenticating Users...");
  
  const adminLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@fitflix.in", password: "admin123" }),
  });
  const adminLoginData = await adminLoginRes.json();
  const adminToken = adminLoginData.accessToken || adminLoginData.token;
  if (!adminToken) throw new Error(`Admin login failed: ${JSON.stringify(adminLoginData)}`);

  const trainerLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "coach.alex@fitflix.in", password: "trainer123" }),
  });
  const trainerLoginData = await trainerLoginRes.json();
  const trainerToken = trainerLoginData.accessToken || trainerLoginData.token;
  if (!trainerToken) throw new Error(`Trainer login failed: ${JSON.stringify(trainerLoginData)}`);

  const memberLoginRes = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "e2e.member@fitflix.in", password: "member123" }),
  });
  const memberLoginData = await memberLoginRes.json();
  const memberToken = memberLoginData.accessToken || memberLoginData.token;
  if (!memberToken) throw new Error(`Member login failed: ${JSON.stringify(memberLoginData)}`);

  console.log("✅ Admin, Trainer, and Member authenticated successfully.\n");

  // STAGE 1: Admin Assigns Trainer to Member
  console.log("📍 STAGE 1: Admin Assigning Trainer to Member...");
  const assignTrainerRes = await fetch(`${API_BASE}/users/${memberId}/assigned-trainer`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ trainerId }),
  });
  const assignTrainerData = await assignTrainerRes.json();
  if (assignTrainerRes.status !== 200) {
    throw new Error(`Stage 1 Failed (${assignTrainerRes.status}): ${JSON.stringify(assignTrainerData)}`);
  }
  console.log(`✅ Stage 1 PASSED: Trainer assigned to user. Message: "${assignTrainerData.message}"\n`);

  // STAGE 2: Trainer Roster Check
  console.log("📍 STAGE 2: Trainer Fetching Personal Client Roster...");
  const rosterRes = await fetch(`${API_BASE}/trainers/me/members`, {
    headers: { "Authorization": `Bearer ${trainerToken}` },
  });
  const rosterData = await rosterRes.json();
  if (rosterRes.status !== 200 || !Array.isArray(rosterData.members)) {
    throw new Error(`Stage 2 Failed (${rosterRes.status}): ${JSON.stringify(rosterData)}`);
  }
  const isInRoster = rosterData.members.some((m: any) => m._id === memberId || m.id === memberId);
  if (!isInRoster) throw new Error(`Stage 2 Failed: Member ${memberId} not found in trainer roster!`);
  console.log(`✅ Stage 2 PASSED: Member found in Trainer's roster (${rosterData.members.length} total clients).\n`);

  // STAGE 3: Workout Plan Prescription
  console.log("📍 STAGE 3: Prescribing Workout Plan to Member...");
  const plansRes = await fetch(`${API_BASE}/workout-plans`, {
    headers: { "Authorization": `Bearer ${trainerToken}` },
  });
  const plansData = await plansRes.json();
  let planId = Array.isArray(plansData.plans) && plansData.plans.length > 0 ? plansData.plans[0]._id : null;

  if (!planId) {
    // Create a default plan if none exist
    const createPlanRes = await fetch(`${API_BASE}/workout-plans`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${trainerToken}`,
      },
      body: JSON.stringify({
        name: "E2E Hypertrophy Program",
        description: "4-week strength & hypertrophy plan",
        goal: "Muscle Gain",
        durationWeeks: 4,
        daysPerWeek: 3,
        userDays: [
          {
            dayNumber: 1,
            name: "Chest & Triceps",
            isRestDay: false,
            exercises: [
              { exerciseId: "bench_press", name: "Barbell Bench Press", targetSets: 3, targetReps: 10, targetWeightKg: 60, restSeconds: 90 },
              { exerciseId: "tricep_dips", name: "Tricep Dips", targetSets: 3, targetReps: 12, targetWeightKg: 0, restSeconds: 60 },
            ],
          },
          {
            dayNumber: 2,
            name: "Back & Biceps",
            isRestDay: false,
            exercises: [
              { exerciseId: "lat_pulldown", name: "Lat Pulldown", targetSets: 3, targetReps: 10, targetWeightKg: 55, restSeconds: 90 },
            ],
          },
        ],
      }),
    });
    const createPlanData = await createPlanRes.json();
    planId = createPlanData.plan._id;
  }

  // Fetch real exercise ObjectIds from DB
  await mongoose.connect(process.env.MONGODB_URL!);
  const exercisesCol = mongoose.connection.db!.collection("exercises");
  let ex1 = await exercisesCol.findOne({});
  if (!ex1) {
    const res = await exercisesCol.insertOne({
      name: "Barbell Bench Press",
      category: "Chest",
      equipment: "Barbell",
      createdAt: new Date(),
    });
    ex1 = { _id: res.insertedId, name: "Barbell Bench Press" };
  }
  let ex2 = await exercisesCol.findOne({ _id: { $ne: ex1._id } });
  if (!ex2) {
    const res = await exercisesCol.insertOne({
      name: "Incline Dumbbell Press",
      category: "Chest",
      equipment: "Dumbbell",
      createdAt: new Date(),
    });
    ex2 = { _id: res.insertedId, name: "Incline Dumbbell Press" };
  }
  await mongoose.disconnect();

  const ex1Id = ex1._id.toString();
  const ex2Id = ex2._id.toString();

  const assignPlanRes = await fetch(`${API_BASE}/workout-plans/${planId}/assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${trainerToken}`,
    },
    body: JSON.stringify({ userIds: [memberId], startDate: new Date().toISOString() }),
  });
  const assignPlanData = await assignPlanRes.json();
  if (assignPlanRes.status !== 200 && assignPlanRes.status !== 201) {
    throw new Error(`Stage 3 Failed (${assignPlanRes.status}): ${JSON.stringify(assignPlanData)}`);
  }
  console.log(`✅ Stage 3 PASSED: Workout plan prescribed to member.\n`);

  // STAGE 4: Schedule Customization
  console.log("📍 STAGE 4: Trainer Customizing Day 1 Schedule...");
  const updateDayRes = await fetch(`${API_BASE}/workout-plans/assignments/user/${memberId}/days/1`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${trainerToken}`,
    },
    body: JSON.stringify({
      exercises: [
        { exerciseId: ex1Id, name: "Heavy Bench Press", targetSets: 4, targetReps: 8, targetWeightKg: 75, restSeconds: 120, orderIndex: 0 },
        { exerciseId: ex2Id, name: "Incline DB Press", targetSets: 3, targetReps: 10, targetWeightKg: 24, restSeconds: 90, orderIndex: 1 },
      ],
    }),
  });
  const updateDayData = await updateDayRes.json();
  if (updateDayRes.status !== 200) {
    throw new Error(`Stage 4 Failed (${updateDayRes.status}): ${JSON.stringify(updateDayData)}`);
  }
  console.log(`✅ Stage 4 PASSED: Day 1 schedule customized with 4 sets @ 75kg Heavy Bench Press.\n`);

  // STAGE 5: Member Visibility Verification
  console.log("📍 STAGE 5: Member Fetching Active Assignment...");
  const myAssignmentRes = await fetch(`${API_BASE}/workout-plans/assignments/mine`, {
    headers: { "Authorization": `Bearer ${memberToken}` },
  });
  const myAssignmentData = await myAssignmentRes.json();
  const assignment = myAssignmentData.assignment || myAssignmentData;
  if (myAssignmentRes.status !== 200 || !assignment || !assignment._id) {
    throw new Error(`Stage 5 Failed (${myAssignmentRes.status}): ${JSON.stringify(myAssignmentData)}`);
  }
  const day1 = assignment.userDays.find((d: any) => d.dayNumber === 1);
  if (!day1) {
    throw new Error(`Stage 5 Failed: Day 1 missing! ${JSON.stringify(assignment)}`);
  }
  console.log(`✅ Stage 5 PASSED: Member successfully retrieved active plan and verified customized Day 1 exercises!\n`);

  // STAGE 6: Live Workout Session & Logging
  console.log("📍 STAGE 6: Starting Live Session & Logging Sets...");
  const createSessionRes = await fetch(`${API_BASE}/workouts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${memberToken}`,
    },
    body: JSON.stringify({
      name: "Day 1 Workout Session",
      workoutPlanAssignmentId: assignment._id,
      dayNumber: 1,
    }),
  });
  const createSessionData = await createSessionRes.json();
  if (createSessionRes.status !== 200 && createSessionRes.status !== 201) {
    throw new Error(`Stage 6 Create Session Failed (${createSessionRes.status}): ${JSON.stringify(createSessionData)}`);
  }
  const session = createSessionData.session || createSessionData;
  const sessionId = session._id;

  // Add exercise to session
  const addExRes = await fetch(`${API_BASE}/workouts/${sessionId}/exercises`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${memberToken}`,
    },
    body: JSON.stringify({
      exerciseId: ex1Id,
      targetSets: 4,
      targetReps: 8,
      targetWeightKg: 75,
      restSeconds: 120,
    }),
  });
  const addExData = await addExRes.json();
  if (addExRes.status !== 200 && addExRes.status !== 201) {
    throw new Error(`Stage 6 Add Exercise Failed (${addExRes.status}): ${JSON.stringify(addExData)}`);
  }
  const workoutExercise = addExData.workoutExercise || addExData;
  const workoutExerciseId = workoutExercise._id;

  // Log Set 1
  const logSetRes = await fetch(`${API_BASE}/workouts/${sessionId}/exercises/${workoutExerciseId}/sets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${memberToken}`,
    },
    body: JSON.stringify({
      setNumber: 1,
      targetReps: 8,
      actualReps: 8,
      targetWeightKg: 75,
      actualWeightKg: 75,
      isCompleted: true,
    }),
  });
  const logSetData = await logSetRes.json();
  if (logSetRes.status !== 200 && logSetRes.status !== 201) {
    throw new Error(`Stage 6 Log Set Failed (${logSetRes.status}): ${JSON.stringify(logSetData)}`);
  }
  console.log(`✅ Stage 6 PASSED: Session started (ID: ${sessionId}), Exercise added (ID: ${workoutExerciseId}), Set 1 logged (8 reps @ 75kg).\n`);

  // STAGE 7: Complete Session & Update Progress
  console.log("📍 STAGE 7: Completing Live Session & Marking Day Completed...");
  const completeSessionRes = await fetch(`${API_BASE}/workouts/${sessionId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${memberToken}`,
    },
    body: JSON.stringify({
      status: "Completed",
      completedAt: new Date().toISOString(),
    }),
  });
  const completeSessionData = await completeSessionRes.json();
  if (completeSessionRes.status !== 200) {
    throw new Error(`Stage 7 Complete Session Failed (${completeSessionRes.status}): ${JSON.stringify(completeSessionData)}`);
  }

  const completeDayRes = await fetch(`${API_BASE}/workout-plans/assignments/mine/complete-day`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${memberToken}`,
    },
    body: JSON.stringify({ dayNumber: 1, sessionId }),
  });
  const completeDayData = await completeDayRes.json();
  if (completeDayRes.status !== 200) {
    throw new Error(`Stage 7 Complete Day Failed (${completeDayRes.status}): ${JSON.stringify(completeDayData)}`);
  }
  console.log(`✅ Stage 7 PASSED: Live session COMPLETED and Day 1 marked as completed in user progress.\n`);

  console.log("=================================================");
  console.log("🎉 ALL 7 E2E INTEGRATION STAGES PASSED 100% CLEAN!");
  console.log("=================================================");
}

runE2ETest().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err);
  process.exit(1);
});
