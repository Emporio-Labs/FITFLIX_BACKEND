// One-off migration: re-categorize exercise `section` values that are stuck on
// the legacy "workout" default.
//
// Rule (deliberately conservative): only rewrite section -> catalog sectionTypes[0]
// when the stored section is "workout" (or missing) AND the exercise catalog says
// the exercise CANNOT live in the main workout section (sectionTypes non-empty and
// does not include "workout"). Deliberate coach placements (e.g. Squats moved to
// warmup) are never touched.
//
// Collections fixed:
//   1. workoutplans            days[].exercises[].section       (source of truth)
//   2. workoutplanassignments  userDays[].exercises[].section   (per-user clones)
//   3. workoutexercises        section, only for Active sessions (today's seeded, unfinished workouts)
//
// Usage: node scratch/migrate-sections.cjs [--dry-run]
const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const DRY = process.argv.includes("--dry-run");

(async () => {
	await mongoose.connect(process.env.MONGODB_URL);
	const db = mongoose.connection.db;
	console.log(`DB: ${db.databaseName}  ${DRY ? "(DRY RUN)" : "(APPLYING)"}`);

	// Catalog: exerciseId -> corrected section (only for exercises that can't be "workout")
	const catalog = await db
		.collection("exercises")
		.find({ sectionTypes: { $exists: true, $ne: [] } })
		.project({ sectionTypes: 1, name: 1 })
		.toArray();
	const fixMap = new Map(); // idString -> { section, name }
	for (const ex of catalog) {
		const types = (ex.sectionTypes || []).map((s) => String(s).toLowerCase());
		if (types.length > 0 && !types.includes("workout")) {
			fixMap.set(ex._id.toString(), { section: types[0], name: ex.name });
		}
	}
	console.log(`Catalog: ${fixMap.size} exercises are warmup/stretching-only`);

	const needsFix = (ex) =>
		(ex.section == null || ex.section === "workout") &&
		ex.exerciseId != null &&
		fixMap.has(ex.exerciseId.toString());

	// ── 1. workoutplans ────────────────────────────────────────────────────────
	let planDocs = 0, planEx = 0;
	for await (const plan of db.collection("workoutplans").find({ "days.exercises.0": { $exists: true } })) {
		let changed = false;
		for (const day of plan.days || []) {
			for (const ex of day.exercises || []) {
				if (needsFix(ex)) {
					const fix = fixMap.get(ex.exerciseId.toString());
					console.log(`  plan "${plan.name}" day ${day.dayNumber}: ${fix.name} workout -> ${fix.section}`);
					ex.section = fix.section;
					changed = true;
					planEx++;
				}
			}
		}
		if (changed && !DRY) {
			await db.collection("workoutplans").updateOne({ _id: plan._id }, { $set: { days: plan.days } });
		}
		if (changed) planDocs++;
	}
	console.log(`workoutplans: ${planEx} exercise(s) across ${planDocs} plan(s)`);

	// ── 2. workoutplanassignments ─────────────────────────────────────────────
	let asgDocs = 0, asgEx = 0;
	for await (const asg of db.collection("workoutplanassignments").find({ "userDays.exercises.0": { $exists: true } })) {
		let changed = false;
		for (const day of asg.userDays || []) {
			for (const ex of day.exercises || []) {
				if (needsFix(ex)) {
					const fix = fixMap.get(ex.exerciseId.toString());
					console.log(`  assignment ${asg._id} day ${day.dayNumber}: ${fix.name} workout -> ${fix.section}`);
					ex.section = fix.section;
					changed = true;
					asgEx++;
				}
			}
		}
		if (changed && !DRY) {
			await db.collection("workoutplanassignments").updateOne({ _id: asg._id }, { $set: { userDays: asg.userDays } });
		}
		if (changed) asgDocs++;
	}
	console.log(`workoutplanassignments: ${asgEx} exercise(s) across ${asgDocs} assignment(s)`);

	// ── 3. workoutexercises in Active (unfinished) sessions ──────────────────
	const activeSessions = await db
		.collection("workoutsessions")
		.find({ status: "Active" })
		.project({ _id: 1 })
		.toArray();
	const activeIds = activeSessions.map((s) => s._id);
	let weFixed = 0;
	if (activeIds.length > 0) {
		const rows = await db
			.collection("workoutexercises")
			.find({
				sessionId: { $in: activeIds },
				$or: [{ section: "workout" }, { section: { $exists: false } }, { section: null }],
			})
			.project({ exerciseId: 1, sessionId: 1 })
			.toArray();
		for (const row of rows) {
			const fix = row.exerciseId && fixMap.get(row.exerciseId.toString());
			if (!fix) continue;
			console.log(`  session ${row.sessionId}: ${fix.name} workout -> ${fix.section}`);
			if (!DRY) {
				await db.collection("workoutexercises").updateOne({ _id: row._id }, { $set: { section: fix.section } });
			}
			weFixed++;
		}
	}
	console.log(`workoutexercises (Active sessions only): ${weFixed} row(s)`);

	await mongoose.disconnect();
	console.log("Done.");
})().catch((e) => { console.error(e); process.exit(1); });
