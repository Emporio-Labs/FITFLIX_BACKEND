import { config } from "dotenv";
config();
import mongoose from "mongoose";
import Exercise from "./src/models/Exercise";

async function run() {
  await mongoose.connect(process.env.MONGODB_URL as string);
  try {
    const docs = await Exercise.find({});
    console.log("Success:", docs.length);
  } catch (e) {
    console.error("DB Error:", e);
  }
  process.exit(0);
}
run();
