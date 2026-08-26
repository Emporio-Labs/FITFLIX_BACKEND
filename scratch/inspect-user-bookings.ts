import { config } from "dotenv";
import connectDB from "../src/utils/db";
import User from "../src/models/User";
import Slot from "../src/models/Slots";
import Service from "../src/models/Service";
import Class from "../src/models/Class";
import ScheduledSession from "../src/models/ScheduledSession";
import Booking from "../src/models/Bookings";

config();

async function main() {
	await connectDB();
	// Register models
	const _u = User;
	const _s = Slot;
	const _svc = Service;
	const _c = Class;
	const _ss = ScheduledSession;

	const bookings = await Booking.find({})
		.populate("user", "username email phone")
		.populate("service")
		.populate("slot")
		.populate("classId")
		.populate("sessionId")
		.sort({ createdAt: -1 })
		.limit(10);

	console.log(`Found ${bookings.length} recent bookings:`);
	for (const b of bookings) {
		const u = b.user as any;
		const s = b.service as any;
		const c = b.classId as any;
		const session = b.sessionId as any;
		console.log("-----------------------------------------");
		console.log(`Booking ID: ${b._id}`);
		console.log(`User: ${u?.username} (${u?.email})`);
		console.log(`Booking Date: ${b.bookingDate}`);
		console.log(`Time on Booking Doc: startTime="${b.startTime}", endTime="${b.endTime}"`);
		console.log(`Service:`, s ? { name: s.serviceName, id: s._id } : null);
		console.log(`Class:`, c ? { name: c.name || c.title, id: c._id } : null, `raw classId: ${b.get("classId")}`);
		console.log(`Session:`, session ? { name: session.name || session.title || session.sessionName, id: session._id, startTime: session.startTime, endTime: session.endTime } : null, `raw sessionId: ${b.get("sessionId")}`);
		console.log(`Slot:`, b.slot ? { id: (b.slot as any)._id, startTime: (b.slot as any).startTime, endTime: (b.slot as any).endTime } : null);
		console.log(`Status: ${b.status}`);
	}

	process.exit(0);
}

main().catch(console.error);
