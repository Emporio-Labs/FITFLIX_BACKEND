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
    const classes = await Class.find({ name: { $regex: /zumba|dance/i } });
    console.log("Classes found:", classes.map(c => ({ id: c._id, name: c.name })));

    const classIds = classes.map(c => c._id);
    const sessions = await ScheduledSession.find({ classId: { $in: classIds } });
    console.log("Sessions found:", sessions.map(s => ({
      id: s._id,
      classId: s.classId,
      sessionDate: s.sessionDate,
      startTime: s.startTime,
      endTime: s.endTime,
      status: s.status,
    })));

    const now = new Date();
    console.log("Current server time (UTC):", now.toISOString());
    console.log("Current server time (local string):", now.toString());
  } catch (err) {
    console.error("Error occurred:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected!");
  }
}

run();
