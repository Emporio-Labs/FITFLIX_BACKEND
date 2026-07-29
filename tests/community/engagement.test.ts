import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import {
	Gender,
	LikeTargetType,
	MembershipStatus,
	PostVisibility,
	ReportStatus,
	UserStatus,
} from "../../src/models/Enums";
import Admin from "../../src/models/Admin";
import Block from "../../src/models/Block";
import Comment from "../../src/models/Comment";
import Like from "../../src/models/Like";
import Membership from "../../src/models/Membership";
import Post from "../../src/models/Post";
import Report from "../../src/models/Report";
import User from "../../src/models/User";
import communityRouter from "../../src/routes/community.routes";
import type { AppUserRole } from "../../src/types/auth";
import { getJwtConfig, signAuthToken } from "../../src/utils/jwt";

config();

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
	if (cond) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}`);
	}
}
function section(title: string): void {
	console.log(`\n── ${title} ──`);
}

function toTestDbUrl(url: string): string {
	const parts = url.split("?");
	const base = parts[0] ?? url;
	const query = parts[1];
	const schemeIdx = base.indexOf("://");
	const afterScheme = base.slice(schemeIdx + 3);
	const slashIdx = afterScheme.indexOf("/");
	const hostPart = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
	const dbPart = slashIdx === -1 ? "" : afterScheme.slice(slashIdx + 1);
	const baseDb = dbPart.length > 0 ? dbPart : "fitflix";
	const rebuilt = `${base.slice(0, schemeIdx + 3)}${hostPart}/${baseDb}_community_test`;
	return query ? `${rebuilt}?${query}` : rebuilt;
}

let counter = 0;
async function createUser(status: UserStatus = UserStatus.Active) {
	counter += 1;
	return User.create({
		username: `eng-${counter}`,
		phone: `912000${String(counter).padStart(4, "0")}`,
		age: 27,
		gender: Gender.Male,
		status,
	});
}
async function addActiveMembership(userId: mongoose.Types.ObjectId) {
	return Membership.create({
		user: userId,
		planName: "Test",
		price: 1,
		status: MembershipStatus.Active,
		startDate: new Date(Date.now() - 86400000),
		endDate: new Date(Date.now() + 30 * 86400000),
	});
}

let base = "";
function tokenFor(id: string, role: AppUserRole): string {
	const cfg = getJwtConfig();
	if (!cfg) throw new Error("JWT not configured");
	return signAuthToken({ id, email: "", role }, cfg);
}

interface ApiResult {
	status: number;
	// biome-ignore lint/suspicious/noExplicitAny: test client
	json: any;
}
async function api(
	method: string,
	path: string,
	token?: string,
	body?: unknown,
): Promise<ApiResult> {
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers["Content-Type"] = "application/json";
	const res = await fetch(base + path, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	let json: unknown = null;
	try {
		json = await res.json();
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

async function createPostAs(token: string, body: string, visibility: string) {
	const res = await api("POST", "/community/posts", token, { body, visibility });
	return res.json.post.id as string;
}

async function run(): Promise<void> {
	const rawUrl = process.env.MONGODB_TEST_URL || process.env.MONGODB_URL;
	if (!rawUrl) throw new Error("MONGODB_URL is not configured");
	await mongoose.connect(
		process.env.MONGODB_TEST_URL ? rawUrl : toTestDbUrl(rawUrl),
	);
	console.log(`Connected to test DB: ${mongoose.connection.name}`);
	await mongoose.connection.dropDatabase();
	await Promise.all([
		User.syncIndexes(),
		Membership.syncIndexes(),
		Post.syncIndexes(),
		Comment.syncIndexes(),
		Like.syncIndexes(),
		Block.syncIndexes(),
		Report.syncIndexes(),
	]);

	const app = express();
	app.use(express.json());
	app.use("/community", communityRouter);
	app.use(
		(
			err: { status?: number; message?: string; code?: string },
			_req: express.Request,
			res: express.Response,
			// biome-ignore lint/correctness/noUnusedFunctionParameters: express error sig
			_next: express.NextFunction,
		) => {
			res
				.status(err?.status ?? 500)
				.json({ error: err?.message ?? "error", code: err?.code ?? "INTERNAL_ERROR" });
		},
	);
	const server = createServer(app);
	await new Promise<void>((resolve) => server.listen(0, resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	// Identities
	const insider = await createUser();
	await addActiveMembership(insider._id);
	const insiderTok = tokenFor(insider._id.toString(), "user");

	const insider2 = await createUser();
	await addActiveMembership(insider2._id);
	const insider2Tok = tokenFor(insider2._id.toString(), "user");

	const outsider = await createUser();
	const outsiderTok = tokenFor(outsider._id.toString(), "user");

	const banned = await createUser(UserStatus.Banned);
	await addActiveMembership(banned._id);
	const bannedTok = tokenFor(banned._id.toString(), "user");

	const trainerTok = tokenFor(new mongoose.Types.ObjectId().toString(), "trainer");
	// A REAL Admin document — the "cannot block an admin" rule looks the target
	// up in the Admin collection.
	const adminDoc = await Admin.create({
		adminName: "Boss",
		email: `admin-eng-${Date.now()}@test.local`,
		phone: "9000000000",
		passwordHash: "x",
	});
	const adminId = adminDoc._id.toString();
	const adminTok = tokenFor(adminId, "admin");

	const publicPost = await createPostAs(insiderTok, "public one", PostVisibility.Public);
	const membersPost = await createPostAs(insiderTok, "members one", PostVisibility.MembersOnly);

	// ── Likes ─────────────────────────────────────────────────────────────────
	section("Likes");
	const outLike = await api("POST", `/community/posts/${publicPost}/like`, outsiderTok);
	check("outsider CAN like a public post", outLike.status === 200 && outLike.json.likeCount === 1);

	const outLikeMembers = await api("POST", `/community/posts/${membersPost}/like`, outsiderTok);
	check("outsider CANNOT like a members_only post", outLikeMembers.status === 403);

	const dbl1 = await api("POST", `/community/posts/${publicPost}/like`, outsiderTok);
	check("double-like is idempotent (200, not 500)", dbl1.status === 200);
	const likeRows1 = await Like.countDocuments({
		userId: outsider._id,
		targetType: LikeTargetType.Post,
		targetId: publicPost,
	});
	check("double-like produced exactly one row", likeRows1 === 1);

	// Concurrent double-like from a fresh user → exactly one row.
	const raceUser = await createUser();
	const raceTok = tokenFor(raceUser._id.toString(), "user");
	await Promise.all([
		api("POST", `/community/posts/${publicPost}/like`, raceTok),
		api("POST", `/community/posts/${publicPost}/like`, raceTok),
	]);
	const raceRows = await Like.countDocuments({
		userId: raceUser._id,
		targetType: LikeTargetType.Post,
		targetId: publicPost,
	});
	check("concurrent double-like → exactly one row", raceRows === 1);

	const bannedLike = await api("POST", `/community/posts/${publicPost}/like`, bannedTok);
	check("banned user cannot like (403)", bannedLike.status === 403);

	// Counter accuracy over a like/unlike cycle.
	const before = (await Post.findById(publicPost).select("likeCount").lean<{ likeCount?: number } | null>())?.likeCount ?? 0;
	await api("POST", `/community/posts/${publicPost}/like`, insiderTok);
	await api("DELETE", `/community/posts/${publicPost}/like`, insiderTok);
	const after = (await Post.findById(publicPost).select("likeCount").lean<{ likeCount?: number } | null>())?.likeCount ?? 0;
	check("counter accurate after like/unlike cycle", before === after);

	// ── Shares ──────────────────────────────────────────────────────────────────
	section("Shares");
	const outShare = await api("POST", `/community/posts/${publicPost}/share`, outsiderTok, { channel: "copy" });
	check(
		"public post shareable by outsider (returns URL)",
		outShare.status === 200 && typeof outShare.json.shareUrl === "string",
	);
	const trainerShareMembers = await api("POST", `/community/posts/${membersPost}/share`, trainerTok, { channel: "copy" });
	check("members_only NOT shareable, even by trainer (403)", trainerShareMembers.status === 403);
	const adminShareMembers = await api("POST", `/community/posts/${membersPost}/share`, adminTok, { channel: "copy" });
	check("members_only NOT shareable, even by admin (403)", adminShareMembers.status === 403);

	// ── Comments ─────────────────────────────────────────────────────────────────
	section("Comments");
	const outComment = await api("POST", `/community/posts/${publicPost}/comments`, outsiderTok, { body: "nope" });
	check("outsider cannot comment (403)", outComment.status === 403);
	const insComment = await api("POST", `/community/posts/${publicPost}/comments`, insiderTok, { body: "insider comment" });
	check("insider can comment (201)", insComment.status === 201);
	check("trainer can comment (201)", (await api("POST", `/community/posts/${publicPost}/comments`, trainerTok, { body: "trainer" })).status === 201);
	check("admin can comment (201)", (await api("POST", `/community/posts/${publicPost}/comments`, adminTok, { body: "admin" })).status === 201);

	const topId = insComment.json.comment.id;
	const reply1 = await api("POST", `/community/posts/${publicPost}/comments`, insider2Tok, { body: "reply", parentId: topId });
	const replyId = reply1.json.comment.id;
	check("reply attaches to top-level parent", reply1.json.comment.parentId === topId);
	// Reply to the reply → should still attach to the top-level parent.
	const nested = await api("POST", `/community/posts/${publicPost}/comments`, insiderTok, { body: "reply to reply", parentId: replyId });
	check("reply-to-reply flattens to top-level parent", nested.json.comment.parentId === topId);

	// Edit permissions
	const authorEdit = await api("PATCH", `/community/comments/${topId}`, insiderTok, { body: "edited" });
	check("author can edit own comment", authorEdit.status === 200);
	const strangerEdit = await api("PATCH", `/community/comments/${topId}`, insider2Tok, { body: "hijack" });
	check("another insider cannot edit (403)", strangerEdit.status === 403);
	const adminEdit = await api("PATCH", `/community/comments/${topId}`, adminTok, { body: "admin edit" });
	check("admin can edit any comment", adminEdit.status === 200);

	// Tombstone + comment_count
	const cntBefore = (await Post.findById(publicPost).select("commentCount").lean<{ commentCount?: number } | null>())?.commentCount ?? 0;
	await api("DELETE", `/community/comments/${topId}`, insiderTok); // delete the top-level that has replies
	const cntAfter = (await Post.findById(publicPost).select("commentCount").lean<{ commentCount?: number } | null>())?.commentCount ?? 0;
	check("comment_count excludes deleted comment", cntAfter === cntBefore - 1);
	const listed = await api("GET", `/community/posts/${publicPost}/comments`, insiderTok);
	// biome-ignore lint/suspicious/noExplicitAny: test
	const tomb = listed.json.comments.find((c: any) => c.id === topId);
	check("deleted comment with replies renders as tombstone", tomb?.deleted === true && tomb?.body === null);
	check("tombstone thread still holds its replies", (tomb?.replies?.length ?? 0) >= 1);

	// ── Blocks ───────────────────────────────────────────────────────────────────
	section("Blocks");
	const userA = await createUser();
	await addActiveMembership(userA._id);
	const aTok = tokenFor(userA._id.toString(), "user");
	const userB = await createUser();
	await addActiveMembership(userB._id);
	const bTok = tokenFor(userB._id.toString(), "user");

	const postByA = await createPostAs(aTok, "A public post", PostVisibility.Public);
	const postByB = await createPostAs(bTok, "B public post", PostVisibility.Public);
	// B comments on a neutral public post so we can test comment hiding.
	await api("POST", `/community/posts/${publicPost}/comments`, bTok, { body: "B comment" });

	const blockRes = await api("POST", `/community/users/${userB._id}/block`, aTok);
	check("A blocks B → success", blockRes.status === 200);

	const aFeed = await api("GET", "/community/feed?limit=50", aTok);
	// biome-ignore lint/suspicious/noExplicitAny: test
	check("A's feed contains ZERO posts by B", !aFeed.json.posts.some((p: any) => p.id === postByB));
	const bFeed = await api("GET", "/community/feed?limit=50", bTok);
	// biome-ignore lint/suspicious/noExplicitAny: test
	check("B's feed contains ZERO posts by A (symmetric)", !bFeed.json.posts.some((p: any) => p.id === postByA));
	const bBlocks = await api("GET", "/community/blocks", bTok);
	check("B receives NO indication of being blocked", (bBlocks.json.blocks?.length ?? 0) === 0);

	const aViewsComments = await api("GET", `/community/posts/${publicPost}/comments`, aTok);
	// biome-ignore lint/suspicious/noExplicitAny: test
	const bCommentVisible = aViewsComments.json.comments.some((c: any) => c.body === "B comment");
	check("blocked user's comments vanish from post detail for the blocker", !bCommentVisible);

	const selfBlock = await api("POST", `/community/users/${userA._id}/block`, aTok);
	check("cannot block self (400)", selfBlock.status === 400);
	const blockAdmin = await api("POST", `/community/users/${adminId}/block`, aTok);
	check("cannot block an admin (403)", blockAdmin.status === 403);

	// ── Reports ──────────────────────────────────────────────────────────────────
	section("Reports");
	const outReport = await api("POST", "/community/reports", outsiderTok, {
		targetType: "post",
		targetId: postByB,
		reason: "spam",
	});
	check("outsider can report (201)", outReport.status === 201);
	check("report row created with status 'pending'", outReport.json.report?.status === ReportStatus.Pending);

	const dupReport = await api("POST", "/community/reports", outsiderTok, {
		targetType: "post",
		targetId: postByB,
		reason: "harassment",
	});
	check("duplicate report returns existing (not created)", dupReport.json.alreadyReported === true);
	const reportFilter: Record<string, unknown> = {
		reporterId: outsider._id,
		targetType: "post",
		targetId: postByB,
	};
	const reportRows = await Report.countDocuments(reportFilter);
	check("duplicate report did NOT create a second row", reportRows === 1);
	check(
		"admin/insider can also report",
		(await api("POST", "/community/reports", insiderTok, { targetType: "post", targetId: postByB, reason: "other", note: "test" })).status === 201,
	);

	server.close();
}

async function main(): Promise<void> {
	console.log("================================================================================");
	console.log("        FITFLIX COMMUNITY DAY 4 — ENGAGEMENT (likes/shares/comments/block/report)");
	console.log("================================================================================");
	try {
		await run();
	} catch (error) {
		console.error("\n[CRITICAL ERROR]", error);
		failed++;
	} finally {
		try {
			await mongoose.connection.dropDatabase();
		} catch {}
		await mongoose.disconnect();
	}
	console.log("\n================================================================================");
	console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`);
	console.log("================================================================================");
	process.exit(failed === 0 ? 0 : 1);
}

main();
