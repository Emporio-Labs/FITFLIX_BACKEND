import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import Block from "../../src/models/Block";
import CommunityProfile from "../../src/models/CommunityProfile";
import {
	Gender,
	MembershipStatus,
	PostVisibility,
	UserStatus,
} from "../../src/models/Enums";
import Membership from "../../src/models/Membership";
import Post from "../../src/models/Post";
import Trainer from "../../src/models/Trainer";
import User from "../../src/models/User";
import communityRouter from "../../src/routes/community.routes";
import { createPost } from "../../src/services/community/post.service";
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
async function createUser(username?: string) {
	counter += 1;
	return User.create({
		username: username ?? `prof-${counter}`,
		phone: `913000${String(counter).padStart(4, "0")}`,
		email: `prof-${counter}@example.com`,
		age: 31,
		gender: Gender.Female,
		dateOfBirth: new Date("1994-05-05"),
		address: "12 Test Street",
		emergencyContact: "9990001111",
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

/** A minimal valid 1x1 JPEG (magic bytes + JFIF header), enough to satisfy the
 *  content sniffer and Jimp. */
const JPEG_1PX = Uint8Array.from(
	Buffer.from(
		"/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
			"HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy" +
			"MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA" +
			"AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA" +
			"AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3" +
			"ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm" +
			"p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA" +
			"AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx" +
			"BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK" +
			"U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3" +
			"uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii" +
			"gD//2Q==",
		"base64",
	),
);

async function uploadAvatar(
	token: string | undefined,
	bytes: Uint8Array = JPEG_1PX,
	mime = "image/jpeg",
	filename = "avatar.jpg",
): Promise<ApiResult> {
	const form = new FormData();
	form.append("image", new Blob([bytes], { type: mime }), filename);
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(`${base}/community/profile/me/avatar`, {
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

/** Every field a public profile is allowed to carry. Asserted as an exact set,
 *  so a future leak of phone/email/age fails this test loudly. */
const ALLOWED_PROFILE_KEYS = [
	"id",
	"name",
	"role",
	"bio",
	"avatarUrl",
	"avatarThumbUrl",
	"memberSince",
	"postCount",
	"isSelf",
	"isBlocked",
].sort();

const FORBIDDEN_PROFILE_KEYS = [
	"phone",
	"email",
	"age",
	"gender",
	"dateOfBirth",
	"address",
	"emergencyContact",
	"passwordHash",
	"status",
	"firebaseUid",
	"healthGoals",
	"onboardingStatus",
];

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
		CommunityProfile.syncIndexes(),
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
	const insider = await createUser("Aditi Sharma");
	await addActiveMembership(insider._id);
	const insiderTok = tokenFor(insider._id.toString(), "user");

	const viewer = await createUser("Bhavna Rao");
	await addActiveMembership(viewer._id);
	const viewerTok = tokenFor(viewer._id.toString(), "user");

	const outsider = await createUser("Chetan Nair");
	const outsiderTok = tokenFor(outsider._id.toString(), "user");

	const suspended = await createUser("Deepak Suspended");
	await addActiveMembership(suspended._id);
	await User.updateOne(
		{ _id: suspended._id },
		{ $set: { status: UserStatus.Suspended } },
	);
	const suspendedTok = tokenFor(suspended._id.toString(), "user");

	// ── Lazy creation ─────────────────────────────────────────────────────────
	section("Lazy creation");
	{
		const before = await CommunityProfile.countDocuments({});
		const { status, json } = await api("GET", "/community/profile/me", insiderTok);
		const after = await CommunityProfile.countDocuments({});
		check("GET /profile/me on a virgin account → 200", status === 200);
		check("synthesized name falls back to username", json?.profile?.name === "Aditi Sharma");
		check("synthesized bio is empty", json?.profile?.bio === "");
		check("synthesized avatar is null", json?.profile?.avatarUrl === null);
		check("isSelf true on own profile", json?.profile?.isSelf === true);
		check("reading created NO document", before === after && after === 0);
	}

	{
		const { status } = await api("PATCH", "/community/profile/me", insiderTok, {
			bio: "Lifting since 2019",
		});
		const count = await CommunityProfile.countDocuments({});
		check("PATCH /profile/me → 200", status === 200);
		check("PATCH created exactly one document", count === 1);
	}

	// ── Validation ────────────────────────────────────────────────────────────
	section("Validation");
	{
		const { status } = await api("PATCH", "/community/profile/me", insiderTok, {
			bio: "x".repeat(200),
		});
		check("200-char bio → 400", status === 400);
	}
	{
		const { status } = await api("PATCH", "/community/profile/me", insiderTok, {});
		check("empty PATCH body → 400", status === 400);
	}
	{
		const { status, json } = await api("PATCH", "/community/profile/me", insiderTok, {
			displayName: "Adi",
		});
		check("displayName set → 200", status === 200);
		check("displayName overrides username", json?.profile?.name === "Adi");
	}
	{
		const { json } = await api("PATCH", "/community/profile/me", insiderTok, {
			displayName: "",
		});
		check(
			'empty displayName clears back to username',
			json?.profile?.name === "Aditi Sharma",
		);
	}

	// ── Privacy: the public DTO's exact key set ───────────────────────────────
	section("Privacy");
	{
		const { status, json } = await api(
			"GET",
			`/community/users/${insider._id}/profile`,
			viewerTok,
		);
		check("GET another user's profile → 200", status === 200);
		const keys = Object.keys(json?.profile ?? {}).sort();
		check(
			`public profile exposes EXACTLY the allowed keys (got: ${keys.join(",")})`,
			JSON.stringify(keys) === JSON.stringify(ALLOWED_PROFILE_KEYS),
		);
		const leaked = FORBIDDEN_PROFILE_KEYS.filter((k) => k in (json?.profile ?? {}));
		check(`no personal fields leaked (leaked: ${leaked.join(",") || "none"})`, leaked.length === 0);
		check("isSelf false when viewing someone else", json?.profile?.isSelf === false);
		check("memberSince is YYYY-MM only", /^\d{4}-\d{2}$/.test(json?.profile?.memberSince ?? ""));
	}

	// ── Access control ────────────────────────────────────────────────────────
	section("Access control");
	{
		const { status } = await api(
			"GET",
			`/community/users/${insider._id}/profile`,
			outsiderTok,
		);
		check("outsider CAN view a profile", status === 200);
	}
	{
		const { status } = await api("PATCH", "/community/profile/me", outsiderTok, {
			bio: "Just joined",
		});
		check("outsider CAN edit their own profile (not gated on post:create)", status === 200);
	}
	{
		const { status } = await api("PATCH", "/community/profile/me", suspendedTok, {
			bio: "nope",
		});
		check("suspended user → 403 on PATCH", status === 403);
	}
	{
		const { status } = await uploadAvatar(suspendedTok);
		check("suspended user → 403 on avatar upload", status === 403);
	}
	{
		const { status } = await api("GET", "/community/profile/me");
		check("unauthenticated → 401", status === 401);
	}

	// ── Avatar lifecycle ──────────────────────────────────────────────────────
	section("Avatar lifecycle");
	let firstAvatarKey = "";
	{
		const { status, json } = await uploadAvatar(insiderTok);
		check("avatar upload → 201", status === 201);
		check("response carries a rendered avatarUrl", Boolean(json?.profile?.avatarUrl));
		check("response carries a thumb URL", Boolean(json?.profile?.avatarThumbUrl));
		const doc = await CommunityProfile.findOne({ ownerId: insider._id }).lean<{
			avatarKey?: string;
			avatarThumbKey?: string;
		}>();
		firstAvatarKey = doc?.avatarKey ?? "";
		check("avatarKey stored as an S3 key under the profiles prefix",
			firstAvatarKey.startsWith("community/profiles/avatars/"));
		check("a separate thumb key was stored",
			Boolean(doc?.avatarThumbKey) && doc?.avatarThumbKey !== firstAvatarKey);
	}
	{
		// THE cache-busting invariant: a replace must never reuse the old path,
		// because the app keys its disk cache on the object path.
		const { status } = await uploadAvatar(insiderTok);
		const doc = await CommunityProfile.findOne({ ownerId: insider._id }).lean<{
			avatarKey?: string;
		}>();
		check("avatar replace → 201", status === 201);
		check(
			"REPLACE WROTE A DIFFERENT S3 KEY (disk-cache invariant)",
			Boolean(doc?.avatarKey) && doc?.avatarKey !== firstAvatarKey,
		);
	}
	{
		const { status, json } = await api(
			"DELETE",
			"/community/profile/me/avatar",
			insiderTok,
		);
		check("avatar remove → 200", status === 200);
		check("avatarUrl is null after removal", json?.profile?.avatarUrl === null);
	}
	{
		const { status } = await uploadAvatar(
			insiderTok,
			Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]),
			"image/jpeg",
			"fake.jpg",
		);
		check("non-image bytes declared as jpeg → rejected", status === 400);
	}
	{
		const res = await fetch(`${base}/community/profile/me/avatar`, {
			method: "POST",
			headers: { Authorization: `Bearer ${insiderTok}` },
			body: new FormData(),
		});
		check("avatar upload with no file → 400", res.status === 400);
	}

	// ── Author objects carry avatars ──────────────────────────────────────────
	section("Feed author avatars");
	{
		await uploadAvatar(insiderTok);
		await createPost(
			{
				authorId: insider._id.toString(),
				authorRole: "insider",
				body: "Morning session done",
				visibility: PostVisibility.Public,
				images: [],
			},
			insider._id.toString(),
		);
		const { status, json } = await api("GET", "/community/feed", viewerTok);
		const post = json?.posts?.[0];
		check("feed → 200", status === 200);
		check("feed author carries avatarUrl", Boolean(post?.author?.avatarUrl));
		check("feed author still carries id/name/role",
			Boolean(post?.author?.id) && Boolean(post?.author?.name) && Boolean(post?.author?.role));
	}

	// ── Profile post list ─────────────────────────────────────────────────────
	section("Profile post list");
	{
		await createPost(
			{
				authorId: insider._id.toString(),
				authorRole: "insider",
				body: "Members only note",
				visibility: PostVisibility.MembersOnly,
				images: [],
			},
			insider._id.toString(),
		);

		const { status, json } = await api(
			"GET",
			`/community/users/${insider._id}/posts`,
			viewerTok,
		);
		check("GET /users/:id/posts → 200", status === 200);
		check("returns the author's posts", (json?.posts?.length ?? 0) === 2);

		const asOutsider = await api(
			"GET",
			`/community/users/${insider._id}/posts`,
			outsiderTok,
		);
		const locked = asOutsider.json?.posts?.find(
			(p: { locked?: boolean }) => p.locked === true,
		);
		check("outsider sees the members_only post as a LOCKED stub", Boolean(locked));
		check("locked stub carries no content", !locked?.content);

		const profile = await api(
			"GET",
			`/community/users/${insider._id}/profile`,
			viewerTok,
		);
		check("postCount agrees with the list", profile.json?.profile?.postCount === 2);
	}
	{
		const p1 = await api(
			"GET",
			`/community/users/${insider._id}/posts?limit=1`,
			viewerTok,
		);
		check("page one respects limit", p1.json?.posts?.length === 1);
		check("page one returns a cursor", Boolean(p1.json?.nextCursor));
		const p2 = await api(
			"GET",
			`/community/users/${insider._id}/posts?limit=1&cursor=${encodeURIComponent(p1.json.nextCursor)}`,
			viewerTok,
		);
		check("page two returns the other post", p2.json?.posts?.length === 1);
		check("no overlap between pages", p1.json.posts[0].id !== p2.json.posts[0].id);
		check("last page terminates the cursor", p2.json?.nextCursor === null);
	}

	// ── People search ─────────────────────────────────────────────────────────
	section("People search");
	{
		const { status, json } = await api(
			"GET",
			"/community/users/search?q=Bhav",
			insiderTok,
		);
		check("people search → 200", status === 200);
		check(
			"finds the matching member",
			json?.people?.some((p: { id: string }) => p.id === viewer._id.toString()),
		);
		const hit = json?.people?.find(
			(p: { id: string }) => p.id === viewer._id.toString(),
		);
		const keys = Object.keys(hit ?? {}).sort();
		check(
			`search hit exposes only thin fields (got: ${keys.join(",")})`,
			JSON.stringify(keys) ===
				JSON.stringify(["avatarThumbUrl", "bio", "id", "isSelf", "name", "role"]),
		);
	}
	{
		const { json } = await api("GET", "/community/users/search?q=Adi", insiderTok);
		const self = json?.people?.find(
			(p: { id: string }) => p.id === insider._id.toString(),
		);
		check("self appears in search, flagged isSelf", self?.isSelf === true);
	}
	{
		const { status } = await api("GET", "/community/users/search", insiderTok);
		check("search without q → 400", status === 400);
	}
	{
		const { status } = await api("GET", "/community/users/search?q=Adi", outsiderTok);
		check("outsider may search", status === 200);
	}
	{
		// Route-ordering guard: "search" must not be swallowed by "/users/:id/*".
		const { status } = await api(
			"GET",
			"/community/users/search?q=zzz-no-such-person",
			insiderTok,
		);
		check("literal /users/search is not shadowed by /users/:id", status === 200);
	}
	{
		const trainer = await Trainer.create({
			trainerName: "Bhaskar Coach",
			email: `coach-${Date.now()}@example.com`,
			phone: "9998887777",
			passwordHash: "x",
			description: "Strength coach",
		});
		const { json } = await api("GET", "/community/users/search?q=Bha", insiderTok);
		check(
			"trainers lead page one of a people search",
			json?.people?.[0]?.id === trainer._id.toString(),
		);
		check("trainer hit carries the trainer role", json?.people?.[0]?.role === "trainer");
	}

	// ── Blocking ──────────────────────────────────────────────────────────────
	section("Blocking");
	{
		await Block.create({ blockerId: viewer._id, blockedId: insider._id });

		const profile = await api(
			"GET",
			`/community/users/${insider._id}/profile`,
			viewerTok,
		);
		check("blocker → 404 on the blocked user's profile", profile.status === 404);

		const posts = await api(
			"GET",
			`/community/users/${insider._id}/posts`,
			viewerTok,
		);
		check("blocker → 404 on the blocked user's posts", posts.status === 404);

		// Symmetric: the blocked party must not see the blocker either.
		const reverse = await api(
			"GET",
			`/community/users/${viewer._id}/profile`,
			insiderTok,
		);
		check("blocked party → 404 on the blocker's profile (symmetric)", reverse.status === 404);

		const search = await api("GET", "/community/users/search?q=Adi", viewerTok);
		check(
			"blocked user absent from search results",
			!search.json?.people?.some(
				(p: { id: string }) => p.id === insider._id.toString(),
			),
		);

		await Block.deleteMany({ blockerId: viewer._id, blockedId: insider._id });
	}

	// ── Not found ─────────────────────────────────────────────────────────────
	section("Not found");
	{
		const ghost = new mongoose.Types.ObjectId().toString();
		const { status } = await api(
			"GET",
			`/community/users/${ghost}/profile`,
			insiderTok,
		);
		check("unknown user id → 404", status === 404);
	}
	{
		const { status } = await api(
			"GET",
			"/community/users/not-an-objectid/profile",
			insiderTok,
		);
		check("malformed user id → 404", status === 404);
	}

	server.close();
}

async function main(): Promise<void> {
	console.log(
		"================================================================================",
	);
	console.log("COMMUNITY PROFILES TEST");
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
