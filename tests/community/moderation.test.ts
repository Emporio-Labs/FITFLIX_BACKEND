import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import {
	Gender,
	MembershipStatus,
	PostVisibility,
	ReportStatus,
	UserStatus,
} from "../../src/models/Enums";
import Admin from "../../src/models/Admin";
import Comment from "../../src/models/Comment";
import Membership from "../../src/models/Membership";
import ModerationAction from "../../src/models/ModerationAction";
import Post from "../../src/models/Post";
import PostVersion from "../../src/models/PostVersion";
import Report from "../../src/models/Report";
import User from "../../src/models/User";
import communityAdminRouter from "../../src/routes/community-admin.routes";
import communityRouter from "../../src/routes/community.routes";
import type { AppUserRole } from "../../src/types/auth";
import {
	getJwtConfig,
	signAdminToken,
	signAuthToken,
	signStepUpToken,
} from "../../src/utils/jwt";
import { APPEND_ONLY_ERROR } from "../../src/utils/mongoose-append-only";

config();

let passed = 0;
let failed = 0;
let auditsExpected = 0; // incremented for each SUCCESSFUL admin write
function check(name: string, cond: boolean): void {
	if (cond) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}`);
	}
}
function section(t: string): void {
	console.log(`\n── ${t} ──`);
}
function toTestDbUrl(url: string): string {
	const [b, q] = url.split("?");
	const i = (b ?? url).indexOf("://");
	const a = (b ?? url).slice(i + 3);
	const s = a.indexOf("/");
	const host = s === -1 ? a : a.slice(0, s);
	const db = s === -1 ? "fitflix" : a.slice(s + 1);
	const out = `${(b ?? url).slice(0, i + 3)}${host}/${db}_community_test`;
	return q ? `${out}?${q}` : out;
}

let base = "";
const cfg = () => {
	const c = getJwtConfig();
	if (!c) throw new Error("JWT not configured");
	return c;
};

interface Res {
	status: number;
	// biome-ignore lint/suspicious/noExplicitAny: test
	json: any;
}
async function api(
	method: string,
	path: string,
	opts: { token?: string; stepUp?: string; body?: unknown } = {},
): Promise<Res> {
	const headers: Record<string, string> = {};
	if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
	if (opts.stepUp) headers["X-Step-Up-Token"] = opts.stepUp;
	if (opts.body !== undefined) headers["Content-Type"] = "application/json";
	const res = await fetch(base + path, {
		method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});
	let json: unknown = null;
	try {
		json = await res.json();
	} catch {}
	return { status: res.status, json };
}

let counter = 0;
async function makeUser(status: UserStatus = UserStatus.Active) {
	counter++;
	const u = await User.create({
		username: `mod-${counter}`,
		phone: `913000${String(counter).padStart(4, "0")}`,
		age: 30,
		gender: Gender.Male,
		status,
	});
	await Membership.create({
		user: u._id,
		planName: "T",
		price: 1,
		status: MembershipStatus.Active,
		startDate: new Date(Date.now() - 86400000),
		endDate: new Date(Date.now() + 30 * 86400000),
	});
	return u;
}
const tok = (id: string, role: AppUserRole) =>
	signAuthToken({ id, email: "", role }, cfg());

async function run(): Promise<void> {
	const raw = process.env.MONGODB_TEST_URL || process.env.MONGODB_URL;
	if (!raw) throw new Error("MONGODB_URL is not configured");
	await mongoose.connect(process.env.MONGODB_TEST_URL ? raw : toTestDbUrl(raw));
	console.log(`Connected: ${mongoose.connection.name}`);
	await mongoose.connection.dropDatabase();
	await Promise.all([
		User.syncIndexes(),
		Post.syncIndexes(),
		Comment.syncIndexes(),
		Report.syncIndexes(),
	]);

	const app = express();
	app.use(express.json());
	app.use("/community/admin", communityAdminRouter);
	app.use("/community", communityRouter);
	app.use(
		(
			err: { status?: number; message?: string; code?: string },
			_req: express.Request,
			res: express.Response,
			// biome-ignore lint/correctness/noUnusedFunctionParameters: express sig
			_next: express.NextFunction,
		) => {
			res.status(err?.status ?? 500).json({
				error: err?.message ?? "error",
				code: err?.code ?? "INTERNAL_ERROR",
			});
		},
	);
	const server = createServer(app);
	await new Promise<void>((r) => server.listen(0, r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	// Fixtures
	const adminDoc = await Admin.create({
		adminName: "Mod Boss",
		email: `mod-admin-${Date.now()}@t.local`,
		phone: "9000000000",
		passwordHash: "x",
	});
	const adminId = adminDoc._id.toString();
	const adminTok = signAdminToken({ id: adminId, email: "", role: "admin" }, cfg());
	const stepUp = signStepUpToken(adminId, cfg());

	const insider = await makeUser();
	const insiderTok = tok(insider._id.toString(), "user");
	const outsiderUser = await User.create({
		username: "mod-out",
		phone: "9139999999",
		age: 30,
		gender: Gender.Male,
	});
	const outsiderTok = tok(outsiderUser._id.toString(), "user");

	const pub = await api("POST", "/community/posts", {
		token: insiderTok,
		body: { body: "public post", visibility: "public" },
	});
	const postId = pub.json.post.id;
	const mem = await api("POST", "/community/posts", {
		token: insiderTok,
		body: { body: "members secret", visibility: "members_only" },
	});
	const memPostId = mem.json.post.id;
	const cmt = await api("POST", `/community/posts/${postId}/comments`, {
		token: insiderTok,
		body: { body: "a comment" },
	});
	const commentId = cmt.json.comment.id;
	await api("POST", "/community/reports", {
		token: insiderTok,
		body: { targetType: "post", targetId: postId, reason: "spam" },
	});

	// ── Admin auth gate ──────────────────────────────────────────────────────
	section("Admin auth hardening");
	check(
		"member token → admin endpoint 403",
		(await api("GET", "/community/admin/posts", { token: insiderTok })).status ===
			403,
	);
	const unscopedAdmin = signAuthToken(
		{ id: adminId, email: "", role: "admin" },
		cfg(),
	);
	check(
		"admin token WITHOUT scope → 401 (forces re-login)",
		(await api("GET", "/community/admin/posts", { token: unscopedAdmin }))
			.status === 401,
	);
	check(
		"scoped admin token → list posts 200",
		(await api("GET", "/community/admin/posts", { token: adminTok })).status ===
			200,
	);

	// ── Destructive gates (step-up + reason) ─────────────────────────────────
	section("Step-up + reason gates");
	check(
		"delete post WITHOUT step-up → 401",
		(await api("DELETE", `/community/admin/posts/${postId}`, {
			token: adminTok,
			body: { reason: "x" },
		})).status === 401,
	);
	check(
		"delete post WITHOUT reason → 400",
		(await api("DELETE", `/community/admin/posts/${postId}`, {
			token: adminTok,
			stepUp,
			body: {},
		})).status === 400,
	);

	// ── Post moderation (each successful write = one audit row) ──────────────
	section("Post moderation + audit");
	check(
		"admin delete post (step-up + reason) → 200",
		(await del(`/community/admin/posts/${postId}`, adminTok, stepUp, {
			reason: "spam removal",
		})).status === 200,
	);
	auditsExpected++;
	check(
		"admin restore post → 200",
		(await api("POST", `/community/admin/posts/${postId}/restore`, {
			token: adminTok,
			body: { reason: "appeal upheld" },
		})).status === 200,
	);
	auditsExpected++;

	const beforeVersions = await PostVersion.countDocuments({ postId });
	check(
		"admin edit post → 200",
		(await api("PATCH", `/community/admin/posts/${postId}`, {
			token: adminTok,
			body: { body: "edited by admin", reason: "cleanup" },
		})).status === 200,
	);
	auditsExpected++;
	const adminVersion = await PostVersion.findOne({ postId, editedBy: adminId }).lean();
	check(
		"admin edit wrote a post_version with editedBy = admin",
		adminVersion != null &&
			(await PostVersion.countDocuments({ postId })) === beforeVersions + 1,
	);

	// Pin: one at a time
	await api("POST", `/community/admin/posts/${postId}/pin`, { token: adminTok });
	auditsExpected++;
	await api("POST", `/community/admin/posts/${memPostId}/pin`, {
		token: adminTok,
	});
	auditsExpected++;
	const pinnedCount = await Post.countDocuments({ pinnedAt: { $ne: null } });
	check("only one post pinned at a time", pinnedCount === 1);

	// Official post
	const official = await api("POST", "/community/admin/posts/official", {
		token: adminTok,
		body: { body: "Gym reopens Monday 6am 🏋️", visibility: "public" },
	});
	check("create official post → 201 isOfficial", official.status === 201);
	auditsExpected++;
	const officialPost = await Post.findById(official.json.postId)
		.select("isOfficial")
		.lean<{ isOfficial?: boolean } | null>();
	check("official post has isOfficial=true", officialPost?.isOfficial === true);

	// Delete comment
	check(
		"admin delete comment (step-up + reason) → 200",
		(await del(`/community/admin/comments/${commentId}`, adminTok, stepUp, {
			reason: "abuse",
		})).status === 200,
	);
	auditsExpected++;

	// ── Report queue ──────────────────────────────────────────────────────────
	section("Report queue");
	const queue = await api("GET", "/community/admin/reports", { token: adminTok });
	check(
		"pending report shows inline content + reporter + age",
		queue.json.reports.length >= 1 &&
			queue.json.reports[0].content != null &&
			typeof queue.json.reports[0].ageHours === "number",
	);
	const reportId = queue.json.reports[0].id;
	check(
		"resolve report (dismiss) → 200",
		(await api("POST", `/community/admin/reports/${reportId}/resolve`, {
			token: adminTok,
			stepUp,
			body: { action: "dismiss", reason: "not a violation" },
		})).status === 200,
	);
	auditsExpected++;
	const resolved = await Report.findById(reportId).lean<{ status?: string } | null>();
	check("report status set to dismissed", resolved?.status === ReportStatus.Dismissed);

	// ── User moderation ──────────────────────────────────────────────────────
	section("User moderation");
	check(
		"suspend user (step-up + reason) → 200",
		(await api("POST", `/community/admin/users/${insider._id}/suspend`, {
			token: adminTok,
			stepUp,
			body: { reason: "harassment", until: new Date(Date.now() + 7 * 86400000) },
		})).status === 200,
	);
	auditsExpected++;
	check(
		"suspended user CANNOT create a post (403)",
		(await api("POST", "/community/posts", {
			token: insiderTok,
			body: { body: "should fail" },
		})).status === 403,
	);
	await api("POST", `/community/admin/users/${insider._id}/unsuspend`, {
		token: adminTok,
		body: {},
	});
	auditsExpected++;

	// Assign trainer role → member's next post gets the trainer badge
	await api("POST", `/community/admin/users/${insider._id}/role`, {
		token: adminTok,
		body: {},
	});
	auditsExpected++;
	const trainerPost = await api("POST", "/community/posts", {
		token: insiderTok,
		body: { body: "coach tip" },
	});
	check(
		"role-assigned member posts with author.role = trainer",
		trainerPost.json.post?.author?.role === "trainer",
	);
	await api("DELETE", `/community/admin/users/${insider._id}/role`, {
		token: adminTok,
	});
	auditsExpected++;

	check(
		"ban user (step-up + reason) → 200",
		(await api("POST", `/community/admin/users/${insider._id}/ban`, {
			token: adminTok,
			stepUp,
			body: { reason: "repeat offender" },
		})).status === 200,
	);
	auditsExpected++;

	// ── Audit count ──────────────────────────────────────────────────────────
	section("Audit completeness");
	const auditCount = await ModerationAction.countDocuments({ adminId });
	check(
		`every admin write logged: ${auditCount} rows == ${auditsExpected} actions`,
		auditCount === auditsExpected,
	);

	// ── History read-only + append-only (DoD #4) ─────────────────────────────
	section("History append-only (DB level)");
	const v = await PostVersion.findOne({ postId }).lean<{ _id: mongoose.Types.ObjectId } | null>();
	await expectAppendOnly("post_versions UPDATE", () =>
		PostVersion.updateOne({ _id: v?._id }, { contentSnapshot: "hacked" }),
	);
	await expectAppendOnly("post_versions DELETE", () =>
		PostVersion.deleteOne({ _id: v?._id }),
	);
	const ma = await ModerationAction.findOne({ adminId }).lean<{ _id: mongoose.Types.ObjectId } | null>();
	await expectAppendOnly("moderation_actions UPDATE", () =>
		ModerationAction.updateOne({ _id: ma?._id }, { reason: "tampered" }),
	);
	await expectAppendOnly("moderation_actions DELETE", () =>
		ModerationAction.deleteOne({ _id: ma?._id }),
	);

	// ── Outsider members_only leak (DoD #5) ──────────────────────────────────
	section("No premium leak to outsiders");
	const outFeed = await api("GET", "/community/feed?limit=50", {
		token: outsiderTok,
	});
	// biome-ignore lint/suspicious/noExplicitAny: test
	const stub = outFeed.json.posts.find((p: any) => p.id === memPostId);
	check(
		"outsider members_only row is a locked stub (no content/media)",
		stub?.locked === true && !("content" in stub) && !("media" in stub),
	);

	server.close();
}

async function del(
	path: string,
	token: string,
	stepUp: string,
	body: unknown,
): Promise<Res> {
	return api("DELETE", path, { token, stepUp, body });
}

async function expectAppendOnly(name: string, fn: () => Promise<unknown>) {
	try {
		await fn();
		check(`${name} (expected rejection, but SUCCEEDED)`, false);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		check(`${name} → rejected: ${msg}`, msg.includes(APPEND_ONLY_ERROR));
	}
}

async function main(): Promise<void> {
	console.log("================================================================");
	console.log("     FITFLIX COMMUNITY DAY 5 — MODERATION / AUDIT / HARDENING     ");
	console.log("================================================================");
	try {
		await run();
	} catch (e) {
		console.error("\n[CRITICAL ERROR]", e);
		failed++;
	} finally {
		try {
			await mongoose.connection.dropDatabase();
		} catch {}
		await mongoose.disconnect();
	}
	console.log("\n================================================================");
	console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`);
	console.log("================================================================");
	process.exit(failed === 0 ? 0 : 1);
}

main();
