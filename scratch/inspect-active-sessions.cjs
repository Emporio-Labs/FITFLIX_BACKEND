// Show all Active workout sessions and their exercise sections (with timestamps).
const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

(async () => {
	await mongoose.connect(process.env.MONGODB_URL);
	const db = mongoose.connection.db;
	const sessions = await db
		.collection("workoutsessions")
		.find({ status: "Active" })
		.sort({ updatedAt: -1 })
		.toArray();
	console.log("Active sessions:", sessions.length);
	for (const s of sessions) {
		const user = await db.collection("users").findOne(
			{ _id: s.userId },
			{ projection: { email: 1, phone: 1 } },
		);
		console.log(`\n=== session ${s._id} user=${user?.email || user?.phone} date=${s.date?.toISOString?.()?.slice(0, 10)} updatedAt=${s.updatedAt?.toISOString?.()} ===`);
		const rows = await db
			.collection("workoutexercises")
			.find({ sessionId: s._id })
			.sort({ orderIndex: 1 })
			.toArray();
		for (const r of rows) {
			const ex = await db.collection("exercises").findOne(
				{ _id: r.exerciseId },
				{ projection: { name: 1, sectionTypes: 1 } },
			);
			console.log(`   [${r.orderIndex}] ${ex?.name}  section=${JSON.stringify(r.section)}  createdAt=${r.createdAt?.toISOString?.()}`);
		}
	}
	await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
