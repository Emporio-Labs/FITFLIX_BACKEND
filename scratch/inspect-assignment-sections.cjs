// Inspect section values on active workout plan assignments + their source plans.
const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

(async () => {
	await mongoose.connect(process.env.MONGODB_URL, { dbName: process.env.DB_NAME || undefined });
	const db = mongoose.connection.db;
	console.log("DB:", db.databaseName);

	const assignments = await db
		.collection("workoutplanassignments")
		.find({ status: "active" })
		.project({ userId: 1, planId: 1, userDays: 1, startDate: 1 })
		.toArray();

	console.log("Active assignments:", assignments.length);
	for (const a of assignments) {
		const user = await db.collection("users").findOne(
			{ _id: a.userId },
			{ projection: { email: 1, name: 1, phone: 1 } },
		);
		const plan = await db.collection("workoutplans").findOne(
			{ _id: a.planId },
			{ projection: { name: 1, updatedAt: 1 } },
		);
		console.log(`\n=== assignment ${a._id} user=${user?.email || user?.phone || a.userId} plan="${plan?.name}" ===`);
		for (const day of a.userDays || []) {
			if (!day.exercises?.length) continue;
			const ids = day.exercises.map((e) => e.exerciseId);
			const exDocs = await db
				.collection("exercises")
				.find({ _id: { $in: ids } })
				.project({ name: 1, sectionTypes: 1 })
				.toArray();
			const nameMap = new Map(exDocs.map((e) => [e._id.toString(), e]));
			console.log(` Day ${day.dayNumber} "${day.name}":`);
			for (const ex of day.exercises) {
				const info = nameMap.get(ex.exerciseId.toString());
				console.log(
					`   - ${info?.name ?? ex.exerciseId}  section=${JSON.stringify(ex.section)}  catalogSectionTypes=${JSON.stringify(info?.sectionTypes)}`,
				);
			}
		}
	}
	await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
