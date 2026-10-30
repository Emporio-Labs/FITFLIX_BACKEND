// Security guards on the event endpoints, run against stubbed models (no database):
// the public asset proxy, who can mark a ticket paid, who can open a pass, and
// what a scanned QR must carry at the gate.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import EventRegistration from "../src/models/EventRegistration";
import FitflixEvent from "../src/models/FitflixEvent";
import Lead from "../src/models/Lead";
import User from "../src/models/User";
import { EventStatus } from "../src/models/Enums";
import {
	getDigitalPassByTicketId,
	registerForEvent,
	streamEventAsset,
	verifyEventCheckIn,
} from "../src/controllers/event.controller";

function assert(condition: boolean, message: string) {
	if (!condition) {
		console.error(`  ❌ FAILED: ${message}`);
		throw new Error(message);
	}
	console.log(`  ✅ ${message}`);
}

// A mongoose-style query: awaitable, with the chain methods the controller uses.
const query = <T>(value: T) => {
	const q: any = {
		lean: () => q,
		select: () => q,
		populate: () => q,
		sort: () => q,
		then: (ok: (v: T) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(value).then(ok, fail),
	};
	return q;
};

const stub = (model: any, name: string, fn: (...args: any[]) => unknown) => {
	model[name] = fn;
};

type Captured = { status: number; body: any; headers: Record<string, unknown>; piped: boolean };

const call = async (handler: any, req: Record<string, any>): Promise<Captured> => {
	const out: Captured = { status: 200, body: undefined, headers: {}, piped: false };
	const res: any = {
		status(code: number) {
			out.status = code;
			return res;
		},
		json(body: unknown) {
			out.body = body;
			return res;
		},
		setHeader(k: string, v: unknown) {
			out.headers[k] = v;
		},
		// createReadStream(...).pipe(res) writes into a writable; just record it.
		on: () => res,
		once: () => res,
		emit: () => true,
		write: () => true,
		end: () => {
			out.piped = true;
		},
	};
	let nextErr: unknown;
	await handler({ params: {}, query: {}, body: {}, header: () => undefined, ...req }, res, (e: unknown) => {
		nextErr = e;
	});
	if (nextErr) throw nextErr;
	return out;
};

const eventId = new mongoose.Types.ObjectId();
const memberId = new mongoose.Types.ObjectId();
const strangerId = new mongoose.Types.ObjectId();
const TOKEN = "a".repeat(48);

const event = {
	_id: eventId,
	slug: "summit",
	title: "Summit",
	status: EventStatus.Published,
	totalRegistered: 0,
	totalCapacity: 100,
	ticketTiers: [
		{ tierId: "vip", name: "VIP", price: 2000, memberPrice: 500, isMemberIncluded: false, soldQuantity: 0, totalQuantity: 10 },
	],
};

const registration = {
	_id: new mongoose.Types.ObjectId(),
	eventId,
	tierId: "vip",
	tierName: "VIP",
	ticketId: "FFX-SUMM-ABCDEFGH",
	userId: memberId,
	attendeeName: "Asha",
	attendeeEmail: "asha@example.com",
	attendeePhone: "9876543210",
	verificationToken: TOKEN,
	checkedIn: false,
};

const staff = { id: new mongoose.Types.ObjectId().toString(), email: "desk@fitflix.in", role: "staff" };
const member = { id: memberId.toString(), email: "asha@example.com", role: "user" };
const stranger = { id: strangerId.toString(), email: "x@example.com", role: "user" };

function installStubs(existing: typeof registration | null) {
	stub(FitflixEvent, "findOne", () => query(event));
	stub(FitflixEvent, "findById", () => query(event));
	stub(FitflixEvent, "updateOne", async () => ({}));
	stub(FitflixEvent, "findByIdAndUpdate", async () => ({}));
	stub(EventRegistration, "findOne", (filter: any) => {
		if (filter?.ticketId) return query(existing && filter.ticketId === existing.ticketId ? existing : null);
		return query(existing);
	});
	stub(EventRegistration, "exists", async () => null);
	stub(EventRegistration, "create", async (doc: any) => ({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc }));
	stub(EventRegistration, "findOneAndUpdate", async () => ({ ...existing, checkedIn: true, checkedInAt: new Date() }));
	stub(User, "findOne", () => query(null));
	stub(User, "findById", (id: any) =>
		query(String(id) === strangerId.toString() ? { email: "x@example.com", phone: "1111111111" } : null),
	);
	stub(Lead, "findOneAndUpdate", () => Promise.resolve(null));
}

async function assetProxy() {
	console.log("\n🔎 Public asset proxy");
	// A real file on disk, so the guard is what stops it (not a missing S3 client).
	const dir = path.resolve(process.cwd(), "uploads", "medical-reports", "__events_security_test__");
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "report.pdf"), "private");
	try {
		const medical = await call(streamEventAsset, {
			params: { key: ["medical-reports", "__events_security_test__", "report.pdf"] },
		});
		assert(medical.status === 404 && !medical.headers["Content-Type"], "medical-reports keys are not served");
		const traversal = await call(streamEventAsset, {
			params: { key: ["events", "..", "medical-reports", "__events_security_test__", "report.pdf"] },
		});
		assert(traversal.status === 404 && !traversal.headers["Content-Type"], "events/../ traversal is refused");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	const logo = await call(streamEventAsset, { params: { key: ["events", "chapter-5-logo.jpg"] } });
	assert(logo.headers["Content-Type"] === "image/jpeg", "event assets under events/ are still served");
}

async function payment() {
	console.log("\n🔎 Who can mark a ticket paid");
	installStubs(null);
	const body = {
		tierId: "vip",
		attendeeName: "Ravi",
		attendeeEmail: "ravi@example.com",
		attendeePhone: "9000000000",
		paymentReference: "made-up",
	};
	const anon = await call(registerForEvent, { params: { slug: "summit" }, body });
	assert(anon.status === 402, "a visitor's own payment reference does not buy a paid pass");

	const desk = await call(registerForEvent, { params: { slug: "summit" }, body, user: staff });
	assert(desk.status === 201 && desk.body.registration.paymentStatus === "paid", "front desk can record a payment");
	assert(/^FFX-SUMM-[A-HJ-NP-Z2-9]{8}$/.test(desk.body.registration.ticketId), "ticket IDs are 8 random characters");
}

async function duplicateRecovery() {
	console.log("\n🔎 Duplicate registration");
	installStubs(registration);
	const body = { tierId: "vip", attendeeName: "X", attendeeEmail: "asha@example.com", attendeePhone: "9876543210" };
	const anon = await call(registerForEvent, { params: { slug: "summit" }, body });
	assert(anon.status === 409 && anon.body.existingTicketId === undefined, "a stranger is not handed the existing ticket ID");
	const own = await call(registerForEvent, { params: { slug: "summit" }, body, user: member });
	assert(own.status === 409 && own.body.existingTicketId === registration.ticketId, "the owner gets their ticket back");
}

async function passLookup() {
	console.log("\n🔎 Opening a pass");
	installStubs(registration);
	const params = { ticketId: registration.ticketId };
	assert((await call(getDigitalPassByTicketId, { params })).status === 404, "a ticket ID alone does not open the pass");
	assert((await call(getDigitalPassByTicketId, { params, user: stranger })).status === 404, "another member cannot open it");
	assert(
		(await call(getDigitalPassByTicketId, { params, query: { token: "b".repeat(48) } })).status === 404,
		"a wrong token does not open it",
	);
	const withToken = await call(getDigitalPassByTicketId, { params, query: { token: TOKEN } });
	assert(withToken.status === 200 && withToken.body.pass.ticketId === registration.ticketId, "the pass token opens it");
	assert((await call(getDigitalPassByTicketId, { params, user: member })).status === 200, "the owner can open it");
	assert((await call(getDigitalPassByTicketId, { params, user: staff })).status === 200, "staff can open it");
}

async function gateCheckIn() {
	console.log("\n🔎 Gate check-in");
	const scan = (payload: string, extra: Record<string, unknown> = {}) => {
		installStubs({ ...registration });
		return call(verifyEventCheckIn, { user: staff, body: { payload, eventId: eventId.toString(), ...extra } });
	};
	const qr = (token: string) => JSON.stringify({ ticketId: registration.ticketId, token, eventId });

	assert((await scan(qr(TOKEN))).status === 200, "a real pass QR checks in (role 'staff' allowed)");
	const forged = await scan(qr("b".repeat(48)));
	assert(forged.status === 401 && forged.body.code === "INVALID_PASS_TOKEN", "a QR with the wrong token is rejected");
	assert((await scan(registration.ticketId)).status === 401, "a QR holding only the ticket ID is rejected");
	assert((await scan(registration.ticketId, { manual: true })).status === 200, "staff can still type the ticket code");
	assert((await scan(registration.attendeePhone, { manual: true })).status === 200, "staff can still look up by phone");

	installStubs({ ...registration });
	const asMember = await call(verifyEventCheckIn, { user: member, body: { payload: qr(TOKEN) } });
	assert(asMember.status === 403, "members cannot check people in");
}

async function run() {
	console.log("\n🧪 Event security guards");
	await assetProxy();
	await payment();
	await duplicateRecovery();
	await passLookup();
	await gateCheckIn();
	console.log("\n✅ All event security tests passed");
}

run().then(
	() => process.exit(0),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
