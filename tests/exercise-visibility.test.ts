import assert from "node:assert/strict";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Exercise from "../src/models/Exercise";
import Trainer from "../src/models/Trainer";
import { isStaffAuthored, visibleExerciseClauses } from "../src/utils/exercise-visibility";

const url = process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27019/exvis";
await mongoose.connect(url);
await mongoose.connection.db!.dropDatabase();

const trainerA = new mongoose.Types.ObjectId();
const trainerB = new mongoose.Types.ObjectId();
const member = new mongoose.Types.ObjectId();
const otherMember = new mongoose.Types.ObjectId();
await Trainer.collection.insertMany([{ _id: trainerA }, { _id: trainerB }]);
await Admin.collection.insertOne({ _id: new mongoose.Types.ObjectId() });

const base = { muscleGroups: ["Legs"], difficulty: "Beginner" };
await Exercise.collection.insertMany([
	{ ...base, name: "System Squat", isSystem: true, createdBy: null },
	{ ...base, name: "StairMaster", isSystem: false, createdBy: trainerA },
	{ ...base, name: "Member Private", isSystem: false, createdBy: member },
	{ ...base, name: "Deleted Staff", isSystem: false, createdBy: trainerA, isDeleted: true },
]);

const names = async (id: string) =>
	(
		await Exercise.find({ isDeleted: { $ne: true }, $or: await visibleExerciseClauses(id) })
			.select("name")
			.lean()
	)
		.map((e) => e.name)
		.sort();

assert.deepEqual(await names(trainerB.toString()), ["StairMaster", "System Squat"]);
assert.deepEqual(await names(member.toString()), ["Member Private", "StairMaster", "System Squat"]);
assert.deepEqual(await names(otherMember.toString()), ["StairMaster", "System Squat"]);
assert.equal(await isStaffAuthored(trainerA), true);
assert.equal(await isStaffAuthored(member), false);
assert.equal(await isStaffAuthored(null), false);

console.log("exercise-visibility: all assertions passed");
await mongoose.disconnect();
