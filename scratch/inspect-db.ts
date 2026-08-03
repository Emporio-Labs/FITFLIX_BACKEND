import mongoose from "mongoose";
import dotenv from "dotenv";
import ScheduledSession from "../src/models/ScheduledSession";
import Class from "../src/models/Class";

dotenv.config();

async function run() {
  const url = process.env.MONGODB_URL;
  if (!url) {
    console.error("MONGODB_URL is not defined in .env");
    process.exit(1);
  }

  console.log("Connecting to DB...");
  await mongoose.connect(url);
  console.log("Connected!");

  try {
    const classes = await Class.find({});
    console.log("ALL CLASSES IN DB:");
    for (const c of classes) {
      console.log(`- ID: ${c._id}, Name: ${c.name}, Mode: ${c.mode}, sessionType: ${c.sessionType}, startTime: ${c.startTime}`);
    }

    const sessions = await ScheduledSession.find({});
    console.log("\nALL SCHEDULED SESSIONS IN DB:");
    for (const s of sessions) {
      const cls = classes.find(c => c._id.toString() === s.classId.toString());
      console.log(`- ID: ${s._id}, ClassName: ${cls?.name}, Date: ${s.sessionDate?.toISOString()}, StartTime: ${s.startTime}, EndTime: ${s.endTime}`);
    }

  } catch (err) {
    console.error("Error occurred:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected!");
  }
}

run();
