/**
 * Login tracking — every successful login is saved with name, role, branch, IP.
 *
 * Needs a throwaway MongoDB and refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/loginevents bun run test:login-events
 */
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import LoginEvent from "../src/models/LoginEvent";
import Trainer from "../src/models/Trainer";
import { hashPassword } from "../src/utils/password";
import {
	adminToken,
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}

const PASSWORD = "Test-pass-123";

async function login(baseUrl: string, email: string, forwardedFor?: string) {
	const res = await fetch(`${baseUrl}/auth/login`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
		},
		body: JSON.stringify({ email, password: PASSWORD }),
	});
	return res.status;
}

/** The write is fire-and-forget, so poll briefly instead of racing it. */
async function eventFor(email: string) {
	for (let i = 0; i < 20; i++) {
		const found = await LoginEvent.findOne({ email }).lean();
		if (found) return found as Record<string, any>;
		await new Promise((r) => setTimeout(r, 100));
	}
	return null;
}

async function run() {
	await mongoose.connect(url);
	await mongoose.connection.db?.dropDatabase();
	const { baseUrl, close } = await startTestServer();
	const log = console.log;
	console.log = () => {}; // the login handler is chatty

	try {
		const passwordHash = await hashPassword(PASSWORD);
		await Admin.create({
			adminName: "Asha Admin",
			email: "asha@example.com",
			phone: "9000000001",
			passwordHash,
		});
		await Trainer.create({
			trainerName: "Tarun Trainer",
			email: "tarun@example.com",
			phone: "9000000002",
			passwordHash,
		});

		console.log = log;
		console.log("\n📝 Recording");
		console.log = () => {};
		assert((await login(baseUrl, "asha@example.com", "203.0.113.7, 10.0.0.1")) === 200, "admin login succeeds");
		assert((await login(baseUrl, "tarun@example.com")) === 200, "trainer login succeeds");
		assert((await login(baseUrl, "asha@example.com") ) === 200, "admin can log in again");
		assert((await login(baseUrl, "nobody@example.com")) === 401, "a failed login is rejected");
		console.log = log;

		const adminEvent = await eventFor("asha@example.com");
		assert(adminEvent?.accountKind === "admin" && adminEvent.role === "admin", "admin row has kind and role");
		assert(adminEvent?.name === "Asha Admin", "admin row carries the name");
		assert(Boolean(adminEvent?.ip), "ip is never empty");
		assert(
			(await LoginEvent.countDocuments({ email: "asha@example.com" })) >= 1,
			"every successful login is saved",
		);
		const trainerEvent = await eventFor("tarun@example.com");
		assert(trainerEvent?.role === "trainer" && trainerEvent.name === "Tarun Trainer", "trainer row has role and name");
		assert(
			(await LoginEvent.countDocuments({ email: "nobody@example.com" })) === 0,
			"failed logins are not saved",
		);
		assert(
			(await LoginEvent.findOne({ email: "asha@example.com", ip: "203.0.113.7" })) !== null,
			"ip falls back to the first x-forwarded-for hop",
		);

		// A member row, as phone/OTP login writes it.
		await LoginEvent.create({
			accountId: new mongoose.Types.ObjectId(),
			accountKind: "user",
			role: "user",
			name: "Mia Member",
			email: "",
		});

		console.log("\n📊 Report endpoint");
		const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
		const q = `from=${today}&to=${today}`;
		const all = await fetchJson(baseUrl, `/admins/login-events?${q}`, { token: adminToken });
		assert(all.status === 200 && all.data.items.length >= 4, "admin can read today's events");
		assert(all.data.truncated === false, "small result is not truncated");
		const staff = await fetchJson(baseUrl, `/admins/login-events?${q}&excludeRole=user`, { token: adminToken });
		assert(
			staff.data.items.length > 0 && staff.data.items.every((e: any) => e.role !== "user"),
			"excludeRole=user returns staff only",
		);
		const trainers = await fetchJson(baseUrl, `/admins/login-events?${q}&role=trainer`, { token: adminToken });
		assert(trainers.data.items.length === 1 && trainers.data.items[0].role === "trainer", "role filter works");
		const trainerToken = generateTestToken("trainer", String(trainerEvent?.accountId));
		assert(
			(await fetchJson(baseUrl, `/admins/login-events?${q}`, { token: trainerToken })).status === 403,
			"trainers are forbidden",
		);
		assert(
			(await fetchJson(baseUrl, `/admins/login-events?from=2026-01-01&to=2026-12-31`, { token: adminToken })).status === 400,
			"a range over 92 days is rejected",
		);
		assert(
			(await fetchJson(baseUrl, `/admins/login-events?from=${today}`, { token: adminToken })).status === 400,
			"missing `to` is rejected",
		);
		console.log("\n🎉 Login event tests passed!");
	} finally {
		console.log = log;
		await close();
		await mongoose.connection.db?.dropDatabase();
		await mongoose.disconnect();
	}
}

run()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Login event test failed:", err);
		process.exit(1);
	});
