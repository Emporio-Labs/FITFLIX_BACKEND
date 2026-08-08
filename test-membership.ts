  import mongoose from "mongoose";
import { getActiveMembership } from "./src/utils/membership.guard";
import GymVisit from "./src/models/GymVisit";
import User from "./src/models/User";
import Membership from "./src/models/Membership";

async function test() {
  await mongoose.connect("mongodb://localhost:27017/fitflix");
  
  const users = await User.find().limit(5);
  for (const u of users) {
    const mems = await Membership.find({ user: u._id });
    const active = await getActiveMembership(u._id.toString());
    console.log(`User ${u.username} (${u._id}): memberships=${mems.length}, active=${active !== null}`);
  }

  process.exit(0);
}
test();
