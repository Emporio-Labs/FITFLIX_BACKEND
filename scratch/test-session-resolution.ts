import connectDB from "../src/utils/db";
import { resolveSessionAccess } from "../src/services/session-access.service";

async function testResolution() {
	await connectDB();

	const testUser: any = {
		id: "6504d02f-4628-4db5-a40b-f898df6de5dc",
		email: "admin@fitflix.com",
		role: "admin",
	};

	console.log("\n1. Testing with class ID: '6504d02f-4628-4db5-a40b-f898df6de5dc'...");
	const res1 = await resolveSessionAccess({
		sessionId: "6504d02f-4628-4db5-a40b-f898df6de5dc",
		user: testUser,
	});
	console.log("Result 1:", res1);

	console.log("\n2. Testing with session ID: '6a8004c5b74fa756d19299ef'...");
	const res2 = await resolveSessionAccess({
		sessionId: "6a8004c5b74fa756d19299ef",
		user: testUser,
	});
	console.log("Result 2:", res2);

	process.exit(0);
}

testResolution().catch((err) => {
	console.error(err);
	process.exit(1);
});
