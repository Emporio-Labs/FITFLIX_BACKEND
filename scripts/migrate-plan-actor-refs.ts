import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Trainer from "../src/models/Trainer";
import User from "../src/models/User";
import WorkoutPlan from "../src/models/WorkoutPlan";
import WorkoutPlanAssignment from "../src/models/WorkoutPlanAssignment";
import connectDB from "../src/utils/db";

type StaffActorModel = "User" | "Trainer" | "Admin";

config();

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

// WorkoutPlan.createdBy / WorkoutPlanAssignment.assignedBy predate the
// refPath split — every existing row implicitly pointed at "User". Probe
// the other two collections first so any plan actually authored by a
// trainer/admin (the exact bug this migration fixes) gets corrected.
const resolveActorModel = async (
	id: mongoose.Types.ObjectId,
): Promise<StaffActorModel> => {
	if (await Trainer.exists({ _id: id })) return "Trainer";
	if (await Admin.exists({ _id: id })) return "Admin";
	if (await User.exists({ _id: id })) return "User";
	// Dangling reference (deleted account) — default to User, matching the
	// schema's pre-migration implicit behavior.
	return "User";
};

async function migratePlans(dryRun: boolean) {
	const plans = await WorkoutPlan.find({
		$or: [{ createdByModel: { $exists: false } }, { createdByModel: null }],
	})
		.select("_id createdBy")
		.lean();

	let updated = 0;
	for (const plan of plans) {
		const model = await resolveActorModel(plan.createdBy as mongoose.Types.ObjectId);
		if (dryRun) {
			console.log(`[DRY RUN] WorkoutPlan ${plan._id}: createdByModel -> ${model}`);
		} else {
			await WorkoutPlan.findByIdAndUpdate(plan._id, {
				$set: { createdByModel: model },
			});
		}
		updated++;
	}

	console.log(
		`${dryRun ? "[DRY RUN] " : ""}WorkoutPlan: ${updated} updated, ${plans.length - updated} skipped`,
	);
}

async function migrateAssignments(dryRun: boolean) {
	const assignments = await WorkoutPlanAssignment.find({
		$or: [{ assignedByModel: { $exists: false } }, { assignedByModel: null }],
	})
		.select("_id assignedBy")
		.lean();

	let updated = 0;
	for (const assignment of assignments) {
		const model = await resolveActorModel(
			assignment.assignedBy as mongoose.Types.ObjectId,
		);
		if (dryRun) {
			console.log(
				`[DRY RUN] WorkoutPlanAssignment ${assignment._id}: assignedByModel -> ${model}`,
			);
		} else {
			await WorkoutPlanAssignment.findByIdAndUpdate(assignment._id, {
				$set: { assignedByModel: model },
			});
		}
		updated++;
	}

	console.log(
		`${dryRun ? "[DRY RUN] " : ""}WorkoutPlanAssignment: ${updated} updated, ${assignments.length - updated} skipped`,
	);
}

async function main() {
	const dryRun = hasFlag("--dry-run");

	try {
		await connectDB();
		await migratePlans(dryRun);
		await migrateAssignments(dryRun);
		console.log(`\n${dryRun ? "[DRY RUN] " : ""}Migration complete`);
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

main();
