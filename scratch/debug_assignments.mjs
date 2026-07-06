import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: new URL('../.env', import.meta.url).pathname.slice(1) });

const MONGODB_URL = process.env.MONGODB_URL || "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function run() {
  await mongoose.connect(MONGODB_URL);
  const db = mongoose.connection.db;
  console.log("Connected. DB name:", db.databaseName);

  // 1. Recent workout plans with assignedUsers
  const plans = await db.collection('workoutplans')
    .find({}, { projection: { name: 1, status: 1, assignedUsers: 1, createdAt: 1, updatedAt: 1, 'days.dayNumber': 1, 'days.isRestDay': 1, 'days.exercises.exerciseId': 1 } })
    .sort({ updatedAt: -1 }).limit(5).toArray();
  console.log('\n=== Last 5 workout plans ===');
  for (const p of plans) {
    console.log({
      _id: p._id.toString(),
      name: p.name,
      status: p.status,
      assignedUsers: (p.assignedUsers || []).map(String),
      days: (p.days || []).map(d => ({ day: d.dayNumber, rest: d.isRestDay, exCount: (d.exercises || []).length })),
      updatedAt: p.updatedAt,
    });
  }

  // 2. Recent assignments
  const assigns = await db.collection('workoutplanassignments')
    .find({}).sort({ updatedAt: -1 }).limit(5).toArray();
  console.log('\n=== Last 5 workout plan assignments ===');
  for (const a of assigns) {
    console.log({
      _id: a._id.toString(),
      userId: String(a.userId),
      planId: String(a.planId),
      assignedBy: String(a.assignedBy),
      status: a.status,
      isDeleted: a.isDeleted,
      startDate: a.startDate,
      currentDayIndex: a.currentDayIndex,
      dayProgress: (a.dayProgress || []).slice(0, 5).map(d => ({ day: d.dayNumber, date: d.scheduledDate, status: d.status })),
      userDays: (a.userDays || []).map(d => ({ day: d.dayNumber, rest: d.isRestDay, exCount: (d.exercises || []).length })),
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    });
  }

  // 3. For each recent plan's assignedUsers, resolve users
  const userIds = new Set();
  for (const p of plans) for (const u of (p.assignedUsers || [])) userIds.add(String(u));
  for (const a of assigns) userIds.add(String(a.userId));
  if (userIds.size) {
    const users = await db.collection('users')
      .find({ _id: { $in: [...userIds].map(id => new mongoose.Types.ObjectId(id)) } }, { projection: { username: 1, email: 1, phone: 1 } })
      .toArray();
    console.log('\n=== Users referenced ===');
    for (const u of users) console.log({ _id: u._id.toString(), username: u.username, email: u.email, phone: u.phone });
  }

  console.log('\nTotal assignment docs:', await db.collection('workoutplanassignments').countDocuments());
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
