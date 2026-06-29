const mongoose = require("mongoose");
const MONGODB_URL = "mongodb://sambar:sambar@ac-qtgw0eb-shard-00-00.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-01.nmcql8e.mongodb.net:27017,ac-qtgw0eb-shard-00-02.nmcql8e.mongodb.net:27017/?ssl=true&replicaSet=atlas-11n0sq-shard-0&authSource=admin&appName=HYBRIDHUMAN";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URL);
  console.log("Connected!");

  const WorkoutSessionSchema = new mongoose.Schema({
    userId: mongoose.Schema.Types.ObjectId,
    date: Date,
    status: String,
    startedAt: Date,
    completedAt: Date,
    notes: String,
  }, { collection: "workoutsessions" }); // MongoDB collection names are usually pluralized lowercase

  const WorkoutSession = mongoose.model("WorkoutSession", WorkoutSessionSchema);

  const sessions = await WorkoutSession.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log("\nLast 5 workout sessions in MongoDB:");
  for (const s of sessions) {
    console.log(s);
    if (s.startedAt) {
      console.log(`  startedAt: ${s.startedAt.toISOString()} (type: ${typeof s.startedAt}, instance: ${s.startedAt instanceof Date})`);
    }
    if (s.completedAt) {
      console.log(`  completedAt: ${s.completedAt.toISOString()}`);
    }
  }

  await mongoose.disconnect();
}

main().catch(console.error);
