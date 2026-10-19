/**
 * FX-26 — load-test data seeder.
 *
 * Inflates the collections behind the three busiest screens (member home, class
 * booking, Front-desk bookings list) so the k6 harness in `tests/load/` measures
 * realistic, grown-up data instead of an empty dev DB. Everything it creates is
 * tagged (a dedicated `loadtest` Location, `@loadtest.local` accounts, `[LOADTEST]`
 * classes) so `--down` removes exactly this data and nothing else.
 *
 *   bun run seed:loadtest            # wipe prior load-test data, then seed
 *   bun run seed:loadtest -- --small # ~10x smaller, for a quick smoke
 *   bun run seed:loadtest:down       # remove all load-test data
 *
 * FX-26.4 — this NEVER runs against production. The MONGODB_URL host is checked
 * the same way the k6 guard checks BASE_URL: localhost / loopback / RFC-1918 /
 * .internal / .local / .test run freely; a known production pattern is refused
 * outright; any other (e.g. a restored Atlas COPY) requires
 * LOAD_TEST_CONFIRM=prod-copy. Point it at a copy, never the live DB.
 *
 * On success it prints a staff and member JWT (signed exactly as /auth/login
 * signs them) plus a ready-to-run k6 command, so there is no separate token step.
 */

import { config } from "dotenv";
import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import Booking from "../src/models/Bookings";
import Class from "../src/models/Class";
import { BookingStatus, ExpertType, Gender, MembershipStatus } from "../src/models/Enums";
import Location from "../src/models/Location";
import Membership from "../src/models/Membership";
import ScheduledSession from "../src/models/ScheduledSession";
import Slot from "../src/models/Slots";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import { hashPassword } from "../src/utils/password";

// ── Markers (how `--down` finds exactly what we created) ──────────────────────
const LOCATION_CODE = "loadtest";
const LOCATION_NAME = "Load Test Branch";
const MEMBER_EMAIL_DOMAIN = "loadtest.local";
const ADMIN_EMAIL = `loadtest-admin@${MEMBER_EMAIL_DOMAIN}`;
const CLASS_PREFIX = "[LOADTEST] ";
const DEFAULT_PASSWORD = process.env.LOADTEST_PASSWORD || "LoadTest!234";

const hasFlag = (flag: string): boolean => process.argv.slice(2).includes(flag);

// ── FX-26.4 production guard on the Mongo host ────────────────────────────────
const PROD_PATTERNS = [
	"prod",
	"production",
	"fitflix.in",
	"fitflix.com",
	"api.fitflix",
];
const mongoHost = (url: string): string => {
	// mongodb+srv://user:pass@host/db?… — strip scheme, creds, path, query.
	const afterScheme = url.replace(/^mongodb(\+srv)?:\/\//i, "");
	const afterCreds = afterScheme.includes("@")
		? afterScheme.slice(afterScheme.indexOf("@") + 1)
		: afterScheme;
	return (afterCreds.split(/[/?]/)[0] ?? afterCreds).toLowerCase();
};
const isLocalHost = (host: string): boolean =>
	/^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
	host.startsWith("localhost:") ||
	host.endsWith(".local") ||
	host.endsWith(".internal") ||
	host.endsWith(".test");

function assertSafeMongo(url: string): void {
	const host = mongoHost(url);
	const local = isLocalHost(host);
	const looksProd = PROD_PATTERNS.some((p) => host.includes(p));
	if (looksProd && !local) {
		throw new Error(
			`Refusing to seed "${host}" — it matches a production host (FX-26.4). ` +
				"Point MONGODB_URL at a restored COPY of production, never the live DB.",
		);
	}
	if (!local && process.env.LOAD_TEST_CONFIRM !== "prod-copy") {
		throw new Error(
			`MONGODB_URL host "${host}" is not local/private. If this is a restored COPY ` +
				"(never production itself), set LOAD_TEST_CONFIRM=prod-copy to proceed (FX-26.4).",
		);
	}
}

// ── Volumes ───────────────────────────────────────────────────────────────────
const SMALL = hasFlag("--small");
const envInt = (name: string, big: number, small: number): number => {
	const raw = process.env[name];
	if (raw && Number.isFinite(Number(raw))) return Number(raw);
	return SMALL ? small : big;
};
const COUNTS = {
	members: envInt("LOADTEST_MEMBERS", 300, 30),
	classes: envInt("LOADTEST_CLASSES", 40, 8),
	sessionsPast: envInt("LOADTEST_SESSIONS_PAST", 2000, 200),
	sessionsFuture: envInt("LOADTEST_SESSIONS_FUTURE", 600, 60),
	slotTemplates: envInt("LOADTEST_SLOT_TEMPLATES", 20, 6),
	slotsPast: envInt("LOADTEST_SLOTS_PAST", 7000, 700),
	slotsFuture: envInt("LOADTEST_SLOTS_FUTURE", 3000, 300),
	bookings: envInt("LOADTEST_BOOKINGS", 20000, 2000),
};

// ── Small helpers ─────────────────────────────────────────────────────────────
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const timeWindow = (): { startTime: string; endTime: string } => {
	const h = 6 + Math.floor(Math.random() * 15); // 06:00–20:00
	return { startTime: `${pad2(h)}:00`, endTime: `${pad2(h + 1)}:00` };
};
/** A Date `days` from now (negative = past), at a UTC day boundary. */
const dayOffset = (days: number): Date => {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	d.setUTCDate(d.getUTCDate() + days);
	return d;
};

async function insertInBatches(
	label: string,
	model: mongoose.Model<any>,
	docs: Record<string, unknown>[],
	batch = 2000,
): Promise<void> {
	for (let i = 0; i < docs.length; i += batch) {
		await model.insertMany(docs.slice(i, i + batch), { ordered: false });
	}
	console.log(`  ✓ ${label}: ${docs.length}`);
}

// ── Teardown (also runs at the start of an `up` so a reseed is reproducible) ───
async function cleanup(): Promise<void> {
	const memberIds = await User.find({
		email: new RegExp(`@${MEMBER_EMAIL_DOMAIN.replace(".", "\\.")}$`, "i"),
	}).distinct("_id");
	const loc = await Location.findOne({ code: LOCATION_CODE });
	const classIds = loc
		? await Class.find({ locationId: loc._id }).distinct("_id")
		: [];

	const ownerFilter: Record<string, unknown>[] = [{ user: { $in: memberIds } }];
	if (loc) ownerFilter.push({ locationId: loc._id });

	await Booking.deleteMany({ $or: ownerFilter });
	await Membership.deleteMany({ $or: ownerFilter });
	if (loc) await Slot.deleteMany({ locationId: loc._id });
	if (classIds.length)
		await ScheduledSession.deleteMany({ classId: { $in: classIds.map(String) } });
	if (loc) await Class.deleteMany({ locationId: loc._id });
	await User.deleteMany({ _id: { $in: memberIds } });
	await Admin.deleteMany({ email: ADMIN_EMAIL });
	if (loc) await Location.deleteOne({ _id: loc._id });

	console.log(
		`  ✓ removed prior load-test data (${memberIds.length} members, ${classIds.length} classes)`,
	);
}

async function seed(): Promise<void> {
	const passwordHash = await hashPassword(DEFAULT_PASSWORD);

	// Location
	const location = await Location.create({
		name: LOCATION_NAME,
		code: LOCATION_CODE,
		isActive: true,
	});
	const locationId = location._id;
	console.log(`  ✓ location: ${LOCATION_NAME} (${locationId})`);

	// Admin (full admin → passes authorize(["admin"]) on GET /bookings & /slots)
	const admin = await Admin.create({
		adminName: "Load Test Admin",
		email: ADMIN_EMAIL,
		phone: "9000000000",
		passwordHash,
		staffRole: "admin",
		status: "active",
		allBranches: true,
	});

	// Members
	const memberDocs = Array.from({ length: COUNTS.members }, (_, i) => ({
		username: `loadtest-member-${i}`,
		phone: `8${String(100000000 + i).slice(-9)}`,
		email: `loadtest-member-${i}@${MEMBER_EMAIL_DOMAIN}`,
		age: 20 + (i % 40),
		gender: pick(Object.values(Gender)),
		homeLocationId: locationId,
		onboarded: true,
		passwordHash,
	}));
	const members = await User.insertMany(memberDocs, { ordered: false });
	const memberIds = members.map((m) => m._id);
	console.log(`  ✓ members: ${members.length}`);

	// Memberships (one active package per member, with credits to book against)
	await insertInBatches(
		"memberships",
		Membership as mongoose.Model<any>,
		memberIds.map((user) => ({
			user,
			planName: "Load Test Plan",
			creditsIncluded: 500,
			creditsRemaining: 500,
			source: "GRANT",
			locationId,
			status: MembershipStatus.Active,
			price: 0,
			startDate: dayOffset(-30),
			endDate: dayOffset(300),
		})),
	);

	// Classes (the catalogue the class-booking & home screens drill into)
	const classDocs = Array.from({ length: COUNTS.classes }, (_, i) => ({
		locationId,
		name: `${CLASS_PREFIX}Class ${i}`,
		mode: "offline",
		sessionType: "group_class",
		instructor: "Load Test Staff",
		status: "ACTIVE",
		isPublished: true,
		creditCost: 1,
		maxParticipants: 50,
	}));
	const classes = await Class.insertMany(classDocs, { ordered: false });
	const classIds = classes.map((c) => String(c._id));
	console.log(`  ✓ classes: ${classes.length}`);

	// Scheduled sessions — spread across past & future so the member feed's
	// today-forward window and the admin list both have realistic volume.
	const sessionDocs: Record<string, unknown>[] = [];
	const pushSession = (daysAhead: number) => {
		const { startTime, endTime } = timeWindow();
		sessionDocs.push({
			classId: pick(classIds),
			sessionDate: dayOffset(daysAhead),
			startTime,
			endTime,
			deliveryType: "OFFLINE",
			capacity: 50,
			remainingCapacity: 50,
			status: "SCHEDULED",
			isPublished: true,
		});
	};
	for (let i = 0; i < COUNTS.sessionsPast; i++) pushSession(-1 - (i % 90));
	for (let i = 0; i < COUNTS.sessionsFuture; i++) pushSession(i % 60);
	await insertInBatches("sessions", ScheduledSession as mongoose.Model<any>, sessionDocs);

	// Slots — a few recurring templates (date null / isDaily) plus a large body of
	// per-date "concrete" slots across past & future. The past concrete slots are
	// exactly the historical growth FX-26 bounds out of GET /slots by default.
	const templateDocs = Array.from({ length: COUNTS.slotTemplates }, () => {
		const { startTime, endTime } = timeWindow();
		return {
			locationId,
			expertType: ExpertType.Facility,
			date: null,
			isDaily: true,
			startTime,
			endTime,
			capacity: 20,
			remainingCapacity: 20,
		};
	});
	const templates = await Slot.insertMany(templateDocs, { ordered: false });
	const templateIds = templates.map((t) => t._id);
	console.log(`  ✓ slot templates: ${templates.length}`);

	const concreteSlotDocs: Record<string, unknown>[] = [];
	const pushSlot = (daysAhead: number) => {
		const { startTime, endTime } = timeWindow();
		concreteSlotDocs.push({
			locationId,
			expertType: ExpertType.Facility,
			date: dayOffset(daysAhead),
			isDaily: false,
			startTime,
			endTime,
			capacity: 20,
			remainingCapacity: 20,
			parentTemplate: pick(templateIds),
		});
	};
	for (let i = 0; i < COUNTS.slotsPast; i++) pushSlot(-1 - (i % 180));
	for (let i = 0; i < COUNTS.slotsFuture; i++) pushSlot(i % 60);
	await insertInBatches("concrete slots", Slot as mongoose.Model<any>, concreteSlotDocs);

	const slotIds = await Slot.find({ locationId, isDaily: false }).distinct("_id");

	// Bookings — the Front-desk bookings list, grown large across dates & members.
	const statuses = ["Booked", "Confirmed", "Attended", "Cancelled"];
	const bookingDocs: Record<string, unknown>[] = [];
	for (let i = 0; i < COUNTS.bookings; i++) {
		const { startTime, endTime } = timeWindow();
		bookingDocs.push({
			bookingDate: dayOffset(-(i % 180) + (i % 2 === 0 ? 0 : i % 30)),
			startTime,
			endTime,
			status: pick(statuses),
			user: pick(memberIds),
			slot: slotIds.length ? pick(slotIds) : null,
			locationId,
			creditCostSnapshot: 1,
		});
	}
	await insertInBatches("bookings", Booking as mongoose.Model<any>, bookingDocs);

	// ── Tokens (signed exactly as POST /auth/login signs them) ──────────────────
	const jwt = getJwtConfig();
	let staffToken = "";
	let memberToken = "";
	if (jwt) {
		staffToken = signAuthToken(
			{ id: String(admin._id), email: ADMIN_EMAIL, role: "admin", staffRole: "admin" },
			jwt,
		);
		memberToken = signAuthToken(
			{ id: String(memberIds[0] ?? ""), email: memberDocs[0]?.email ?? "", role: "user" },
			jwt,
		);
	}

	console.log("\n────────────────────────────────────────────────────────────");
	console.log("Load-test data ready. Accounts (password below) + tokens:");
	console.log("────────────────────────────────────────────────────────────");
	console.log(`  Staff : ${ADMIN_EMAIL}`);
	console.log(`  Member: ${memberDocs[0]?.email ?? ""}`);
	console.log(`  Password: ${DEFAULT_PASSWORD}`);
	console.log(`  LOCATION_ID: ${locationId}`);
	if (jwt) {
		console.log("\nRun the harness (from the repo root):");
		console.log(
			`  k6 run -e BASE_URL=http://localhost:3000 -e STAFF_TOKEN=${staffToken} -e LOCATION_ID=${locationId} tests/load/frontdesk-bookings.js`,
		);
		console.log(
			`  k6 run -e BASE_URL=http://localhost:3000 -e MEMBER_TOKEN=${memberToken} tests/load/member-home.js`,
		);
		console.log(
			`  k6 run -e BASE_URL=http://localhost:3000 -e MEMBER_TOKEN=${memberToken} tests/load/class-booking.js`,
		);
	} else {
		console.log(
			"\n⚠ JWT_SECRET is not set — tokens were not minted. Set it and log in as the " +
				"accounts above, or re-run after configuring JWT_SECRET.",
		);
	}
	console.log("────────────────────────────────────────────────────────────\n");
}

async function main(): Promise<void> {
	const raw = process.env.MONGODB_URL;
	if (!raw) {
		console.error("MONGODB_URL is not configured in .env");
		process.exit(1);
	}

	try {
		assertSafeMongo(raw);
	} catch (error) {
		console.error((error as Error).message);
		process.exit(1);
	}

	const direction = hasFlag("--down") ? "down" : "up";
	try {
		await connectDB();
		console.log(
			`Running seed-loadtest: ${direction.toUpperCase()} (db: ${mongoose.connection.name})` +
				`${SMALL ? " [--small]" : ""}\n`,
		);
		await cleanup();
		if (direction === "up") {
			await seed();
		} else {
			console.log("\nDOWN complete — load-test data removed.");
		}
	} catch (error) {
		console.error("seed-loadtest failed:", error);
		await mongoose.disconnect();
		process.exit(1);
	}

	await mongoose.disconnect();
	process.exit(0);
}

main();
