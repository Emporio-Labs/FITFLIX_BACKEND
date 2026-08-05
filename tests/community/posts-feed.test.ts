import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import {
	Gender,
	MembershipStatus,
	PostStatus,
	PostVisibility,
} from "../../src/models/Enums";
import Membership from "../../src/models/Membership";
import Post from "../../src/models/Post";
import PostVersion from "../../src/models/PostVersion";
import User from "../../src/models/User";
import communityRouter from "../../src/routes/community.routes";
import { editPost, createPost } from "../../src/services/community/post.service";
import type { AppUserRole } from "../../src/types/auth";
import { getJwtConfig, signAuthToken } from "../../src/utils/jwt";

config();

// ────────────────────────────────────────────────────────────────────────────
// Harness
// ────────────────────────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────────────────────────
// Fixtures + HTTP client
// ────────────────────────────────────────────────────────────────────────────
let counter = 0;
async function createUser() {
	counter += 1;
	return User.create({
		username: `p2-${counter}`,
		phone: `911000${String(counter).padStart(4, "0")}`,
		age: 28,
		gender: Gender.Male,
	});
}
async function addActiveMembership(userId: mongoose.Types.ObjectId, days = 30) {
	return Membership.create({
		user: userId,
		planName: "Test",
		price: 1,
		status: MembershipStatus.Active,
		startDate: new Date(Date.now() - 86400000),
		endDate: new Date(Date.now() + days * 86400000),
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

async function uploadImage(
	token: string | undefined,
	file: { filename: string; mime: string; bytes: Uint8Array },
): Promise<ApiResult> {
	const form = new FormData();
	form.append(
		"images",
		new Blob([file.bytes], { type: file.mime }),
		file.filename,
	);
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`${base}/community/media/images`, {
		method: "POST",
		headers,
		body: form,
	});
	let json: unknown = null;
	try {
		json = await res.json();
	} catch {
		json = null;
	}
	return { status: res.status, json };
}

async function pageAllIds(token: string, limit: number): Promise<string[]> {
	const ids: string[] = [];
	let cursor: string | null = null;
	let guard = 0;
	do {
		const q =
			`/community/feed?limit=${limit}` +
			(cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
		const { status, json } = await api("GET", q, token);
		if (status !== 200) throw new Error(`feed failed: ${status}`);
		for (const p of json.posts) ids.push(p.id);
		cursor = json.nextCursor;
		guard += 1;
	} while (cursor && guard < 200);
	return ids;
}

// ────────────────────────────────────────────────────────────────────────────
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
		PostVersion.syncIndexes(),
	]);

	// Minimal app mounting ONLY the community router (real auth, no Firebase/etc).
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

	const otherInsider = await createUser();
	await addActiveMembership(otherInsider._id);
	const otherInsiderTok = tokenFor(otherInsider._id.toString(), "user");

	const outsider = await createUser();
	const outsiderTok = tokenFor(outsider._id.toString(), "user");

	const expired = await createUser();
	await Membership.create({
		user: expired._id,
		planName: "Test",
		price: 1,
		status: MembershipStatus.Active,
		startDate: new Date(Date.now() - 10 * 86400000),
		endDate: new Date(Date.now() - 86400000), // expired yesterday
	});
	const expiredTok = tokenFor(expired._id.toString(), "user");

	const adminId = new mongoose.Types.ObjectId().toString();
	const adminTok = tokenFor(adminId, "admin");
	const trainerId = new mongoose.Types.ObjectId().toString();
	const trainerTok = tokenFor(trainerId, "trainer");

	// ── Visibility ──────────────────────────────────────────────────────────
	section("Visibility (enforced in the DB query)");
	const pub = await api("POST", "/community/posts", insiderTok, {
		body: "public post",
		visibility: PostVisibility.Public,
	});
	const mem = await api("POST", "/community/posts", insiderTok, {
		body: "members only post",
		visibility: PostVisibility.MembersOnly,
	});
	check("insider create public → 201", pub.status === 201);
	check("insider create members_only → 201", mem.status === 201);
	const publicId = pub.json.post.id;
	const membersOnlyId = mem.json.post.id;

	// Day 3: outsiders RECEIVE members_only posts as REDACTED STUBS (locked),
	// never the premium body or full media URLs.
	const outsiderFeed = await api("GET", "/community/feed", outsiderTok);
	const outsiderStub = outsiderFeed.json.posts.find(
		(p: { id: string }) => p.id === membersOnlyId,
	);
	const outsiderPublic = outsiderFeed.json.posts.find(
		(p: { id: string }) => p.id === publicId,
	);
	check("outsider feed status 200", outsiderFeed.status === 200);
	check("outsider feed includes members_only as a stub", !!outsiderStub);
	check("stub is locked:true", outsiderStub?.locked === true);
	check(
		"stub has NO body content",
		outsiderStub != null && !("content" in outsiderStub),
	);
	check(
		"stub has NO full media array (no full URLs)",
		outsiderStub != null && !("media" in outsiderStub),
	);
	check(
		"stub exposes only a short teaser (≤80 chars)",
		typeof outsiderStub?.titleOrExcerpt === "string" &&
			outsiderStub.titleOrExcerpt.length <= 81,
	);
	check("outsider feed public post is full (locked:false)", outsiderPublic?.locked === false);
	check("feed carries viewer context", outsiderFeed.json.viewer?.role === "outsider");

	const outsiderHitsMembers = await api(
		"GET",
		`/community/posts/${membersOnlyId}`,
		outsiderTok,
	);
	check(
		"outsider GET members_only by id → 200 stub (locked)",
		outsiderHitsMembers.status === 200 &&
			outsiderHitsMembers.json.post.locked === true,
	);
	check(
		"outsider GET stub has no body content",
		outsiderHitsMembers.status === 200 &&
			!("content" in outsiderHitsMembers.json.post),
	);
	const outsiderHitsPublic = await api(
		"GET",
		`/community/posts/${publicId}`,
		outsiderTok,
	);
	check("outsider GET public by id → 200", outsiderHitsPublic.status === 200);

	const insiderFeed = await api("GET", "/community/feed", insiderTok);
	const insiderStub = insiderFeed.json.posts.find(
		(p: { id: string }) => p.id === membersOnlyId,
	);
	check(
		"insider feed sees BOTH public and members_only",
		insiderFeed.json.posts.some((p: { id: string }) => p.id === publicId) &&
			!!insiderStub,
	);
	check("insider members_only row is FULL (locked:false)", insiderStub?.locked === false);
	check("insider members_only row has body content", typeof insiderStub?.content === "string");
	const insiderHitsMembers = await api(
		"GET",
		`/community/posts/${membersOnlyId}`,
		insiderTok,
	);
	check(
		"insider GET members_only by id → 200 full",
		insiderHitsMembers.status === 200 &&
			insiderHitsMembers.json.post.locked === false,
	);

	// Expired membership → treated as outsider (gets stubs, not full rows)
	const expiredFeed = await api("GET", "/community/feed", expiredTok);
	const expiredStub = expiredFeed.json.posts.find(
		(p: { id: string }) => p.id === membersOnlyId,
	);
	check("expired-membership user resolves as outsider", expiredFeed.json.viewer?.role === "outsider");
	check("expired-membership user gets members_only as locked stub", expiredStub?.locked === true);
	const expiredHitsMembers = await api(
		"GET",
		`/community/posts/${membersOnlyId}`,
		expiredTok,
	);
	check(
		"expired-membership user GET members_only → 200 stub",
		expiredHitsMembers.status === 200 &&
			expiredHitsMembers.json.post.locked === true,
	);

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	section("Lifecycle");
	const outsiderCreate = await api("POST", "/community/posts", outsiderTok, {
		body: "should fail",
	});
	check("outsider create → 403", outsiderCreate.status === 403);

	const trainerCreate = await api("POST", "/community/posts", trainerTok, {
		body: "trainer post",
	});
	check("trainer create → 201", trainerCreate.status === 201);
	const adminCreate = await api("POST", "/community/posts", adminTok, {
		body: "admin post",
	});
	check("admin create → 201", adminCreate.status === 201);

	const authorPost = await api("POST", "/community/posts", insiderTok, {
		body: "editable",
	});
	const editableId = authorPost.json.post.id;

	// Author role badges (Day 3): staff authors resolve with a role for the badge.
	check("trainer post author.role = trainer", trainerCreate.json.post.author?.role === "trainer");
	check("admin post author.role = admin", adminCreate.json.post.author?.role === "admin");
	check("insider post author.role = member", authorPost.json.post.author?.role === "member");
	const authorEdit = await api(
		"PATCH",
		`/community/posts/${editableId}`,
		insiderTok,
		{ body: "edited by author" },
	);
	check("author edits own post → 200", authorEdit.status === 200);
	check("edited flag is true", authorEdit.json.post.edited === true);

	const strangerEdit = await api(
		"PATCH",
		`/community/posts/${editableId}`,
		otherInsiderTok,
		{ body: "hijack" },
	);
	check("different insider edits post → 403", strangerEdit.status === 403);

	const adminEdit = await api(
		"PATCH",
		`/community/posts/${editableId}`,
		adminTok,
		{ body: "edited by admin" },
	);
	check("admin edits member's post → 200", adminEdit.status === 200);

	// Soft delete
	const toDelete = await api("POST", "/community/posts", insiderTok, {
		body: "delete me",
	});
	const deleteId = toDelete.json.post.id;
	const del = await api("DELETE", `/community/posts/${deleteId}`, insiderTok);
	check("soft delete → 200", del.status === 200);
	const getDeleted = await api("GET", `/community/posts/${deleteId}`, insiderTok);
	check("deleted post GET by id → 404", getDeleted.status === 404);
	const feedAfterDelete = await api("GET", "/community/feed", insiderTok);
	check(
		"deleted post absent from feed",
		!feedAfterDelete.json.posts.some((p: { id: string }) => p.id === deleteId),
	);

	// Restore inside window
	const restore = await api(
		"POST",
		`/community/posts/${deleteId}/restore`,
		insiderTok,
	);
	check("restore inside window → 200", restore.status === 200);
	const getRestored = await api("GET", `/community/posts/${deleteId}`, insiderTok);
	check("restored post GET by id → 200", getRestored.status === 200);

	// Restore outside window
	const toExpire = await api("POST", "/community/posts", insiderTok, {
		body: "old delete",
	});
	const expireId = toExpire.json.post.id;
	await api("DELETE", `/community/posts/${expireId}`, insiderTok);
	await Post.updateOne(
		{ _id: expireId },
		{ $set: { deletedAt: new Date(Date.now() - 40 * 86400000) } },
	);
	const lateRestore = await api(
		"POST",
		`/community/posts/${expireId}/restore`,
		insiderTok,
	);
	check(
		"restore outside window → 410 (clean, not 500)",
		lateRestore.status === 410 &&
			lateRestore.json.code === "RESTORE_WINDOW_EXPIRED",
	);

	// ── History ───────────────────────────────────────────────────────────────
	section("Edit history");
	const histPost = await api("POST", "/community/posts", insiderTok, {
		body: "v1 content",
	});
	const histId = histPost.json.post.id;
	const v1 = await api("GET", `/community/posts/${histId}/versions`, insiderTok);
	check("create writes version 1", v1.status === 200 && v1.json.versions.length === 1);

	await api("PATCH", `/community/posts/${histId}`, insiderTok, {
		body: "v2 content",
	});
	const v2 = await api("GET", `/community/posts/${histId}/versions`, insiderTok);
	check("edit appends a version (now 2)", v2.json.versions.length === 2);
	check(
		"latest version editedBy = author",
		v2.json.versions[1].editedBy === insider._id.toString(),
	);

	await api("PATCH", `/community/posts/${histId}`, adminTok, {
		body: "v3 by admin",
	});
	const v3 = await api("GET", `/community/posts/${histId}/versions`, insiderTok);
	check(
		"admin edit records ADMIN as editedBy",
		v3.json.versions[2].editedBy === adminId,
	);

	const strangerHistory = await api(
		"GET",
		`/community/posts/${histId}/versions`,
		otherInsiderTok,
	);
	check("another insider reads history → 403", strangerHistory.status === 403);
	const adminHistory = await api(
		"GET",
		`/community/posts/${histId}/versions`,
		adminTok,
	);
	check("admin reads history → 200", adminHistory.status === 200);

	// Transaction rollback (service-level: bypass zod to force a DB failure)
	const rb = await createPost(
		{
			authorId: insider._id.toString(),
			authorRole: "insider",
			body: "rollback base",
			visibility: "public",
			images: [],
		},
		insider._id.toString(),
	);
	const rbId = rb!.id;
	const versionsBefore = await PostVersion.countDocuments({ postId: rbId });
	let threw = false;
	try {
		await editPost(rbId, adminId, { visibility: "not_a_real_visibility" });
	} catch {
		threw = true;
	}
	const versionsAfter = await PostVersion.countDocuments({ postId: rbId });
	check("invalid edit throws", threw);
	check(
		"failed post update rolled back its version row",
		versionsBefore === 1 && versionsAfter === 1,
	);

	// ── Pagination ────────────────────────────────────────────────────────────
	section("Cursor pagination");
	await Post.deleteMany({});
	await Post.insertMany(
		Array.from({ length: 55 }, (_, i) => ({
			authorId: insider._id,
			content: `seed ${i}`,
			visibility: PostVisibility.Public,
			status: PostStatus.Published,
		})),
	);
	const allIds = await pageAllIds(insiderTok, 20);
	check("paged 55 posts returns 55 ids", allIds.length === 55);
	check(
		"no duplicates across pages",
		new Set(allIds).size === 55,
	);

	// Insert mid-pagination must not shift or duplicate
	await Post.deleteMany({});
	await Post.insertMany(
		Array.from({ length: 55 }, (_, i) => ({
			authorId: insider._id,
			content: `seed2 ${i}`,
			visibility: PostVisibility.Public,
			status: PostStatus.Published,
		})),
	);
	const firstPage = await api("GET", "/community/feed?limit=20", insiderTok);
	const collected = new Set<string>(
		firstPage.json.posts.map((p: { id: string }) => p.id),
	);
	let cursor: string | null = firstPage.json.nextCursor;
	const inserted = await api("POST", "/community/posts", insiderTok, {
		body: "inserted mid-pagination",
	});
	const insertedId = inserted.json.post.id;
	let dup = false;
	let guard = 0;
	while (cursor && guard < 200) {
		const { json }: ApiResult = await api(
			"GET",
			`/community/feed?limit=20&cursor=${encodeURIComponent(cursor)}`,
			insiderTok,
		);
		for (const p of json.posts) {
			if (collected.has(p.id)) dup = true;
			collected.add(p.id);
		}
		cursor = json.nextCursor;
		guard += 1;
	}
	check("mid-pagination insert caused no duplicates", !dup);
	check("mid-pagination collected exactly the 55 originals", collected.size === 55);
	check(
		"mid-pagination new post did NOT appear in deeper pages",
		!collected.has(insertedId),
	);

	// ── Upload ────────────────────────────────────────────────────────────────
	section("Image upload validation");
	// MP4 'ftyp' box bytes, mislabelled as image/jpeg with a .jpg name.
	const videoBytes = new Uint8Array([
		0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
		0x00, 0x00, 0x02, 0x00,
	]);
	const spoof = await uploadImage(insiderTok, {
		filename: "clip.jpg",
		mime: "image/jpeg",
		bytes: videoBytes,
	});
	check(
		"video bytes renamed .jpg → rejected by content check",
		spoof.status === 400 && spoof.json.code === "INVALID_IMAGE",
	);

	// Image size is uncapped by default (see UNLIMITED in config/community.ts),
	// so this case only means something with a cap configured. The
	// `test:community-posts` script sets COMMUNITY_MAX_IMAGE_BYTES=10485760 —
	// run this file through that script, not directly, or the 11 MB upload
	// below is accepted and the check fails.
	const oversized = await uploadImage(insiderTok, {
		filename: "big.jpg",
		mime: "image/jpeg",
		bytes: new Uint8Array(11 * 1024 * 1024),
	});
	check(
		"oversized file → rejected (413)",
		oversized.status === 413,
	);

	const noAuth = await uploadImage(undefined, {
		filename: "x.jpg",
		mime: "image/jpeg",
		bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
	});
	check("unauthenticated upload → 401", noAuth.status === 401);

	server.close();
}

async function main(): Promise<void> {
	console.log(
		"================================================================================",
	);
	console.log(
		"          FITFLIX COMMUNITY DAY 2 — POSTS, FEED, HISTORY, UPLOAD TESTS           ",
	);
	console.log(
		"================================================================================",
	);
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
	console.log(
		"\n================================================================================",
	);
	console.log(
		`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`,
	);
	console.log(
		"================================================================================",
	);
	process.exit(failed === 0 ? 0 : 1);
}

main();
