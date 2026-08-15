import connectDB from "../src/utils/db";
import ScheduledSession from "../src/models/ScheduledSession";
import ClassModel from "../src/models/Class";

async function main() {
	await connectDB();
	const sessions = await ScheduledSession.find().lean();
	console.log("=== SCHEDULED SESSIONS count:", sessions.length);
	for (const s of sessions) {
		console.log("Session:", {
			id: s._id.toString(),
			classId: s.classId,
			sessionDate: s.sessionDate,
			startTime: s.startTime,
			endTime: s.endTime,
			status: s.status,
			roomStatus: s.roomStatus,
		});
	}

	const classes = await ClassModel.find().lean();
	console.log("\n=== CLASSES count:", classes.length);
	for (const c of classes) {
		console.log("Class:", {
			id: c._id,
			name: c.name,
			scheduleInfo: c.scheduleInfo,
			daysOfWeek: c.daysOfWeek,
			recurrenceRule: c.recurrenceRule,
			status: c.status,
		});
	}

	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
