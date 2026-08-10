/**
 * One-off end-to-end verification of the community happy path, including a REAL
 * S3 upload round-trip (which the committed test suite deliberately never
 * exercises — it only covers upload rejection paths).
 *
 * Runs against <db>_community_test and deletes every S3 object it creates.
 *   bun run scratch/e2e-community-verify.ts
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "dotenv";
import express from "express";
import { Jimp } from "jimp";
import mongoose from "mongoose";
import { Gender, MembershipStatus } from "../src/models/Enums";
import Membership from "../src/models/Membership";
import PostMedia from "../src/models/PostMedia";
import User from "../src/models/User";
import communityRouter from "../src/routes/community.routes";
import type { AppUserRole } from "../src/types/auth";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import { deleteFromS3 } from "../src/utils/s3.service";

config();

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = ""): void => {
	if (cond) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
	}
};
const section = (t: string) => console.log(`\n── ${t} ──`);

function toTestDbUrl(url: string): string {
	const [b, q] = url.split("?");
	const i = (b ?? url).indexOf("://");
	const a = (b ?? url).slice(i + 3);
	const s = a.indexOf("/");
	const host = s === -1 ? a : a.slice(0, s);
	const db = s === -1 ? "fitflix" : a.slice(s + 1);
	const out = `${(b ?? url).slice(0, i + 3)}${host}/${db || "fitflix"}_community_test`;
	return q ? `${out}?${q}` : out;
}

let base = "";
const token = (id: string, role: AppUserRole): string => {
	const cfg = getJwtConfig();
	if (!cfg) throw new Error("JWT not configured");
	return signAuthToken({ id, email: "", role }, cfg);
};

async function api(
	method: string,
	path: string,
	tok?: string,
	body?: unknown,
	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
): Promise<{ status: number; json: any }> {
	const headers: Record<string, string> = {};
	if (tok) headers.Authorization = `Bearer ${tok}`;
	if (body) headers["Content-Type"] = "application/json";
	const res = await fetch(`${base}${path}`, {
		method,
		headers,
		body: body ? JSON.stringify(body) : undefined,
	});
	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
	let json: any = null;
	try {
		json = await res.json();
	} catch {}
	return { status: res.status, json };
}

const createdKeys: string[] = [];

async function run(): Promise<void> {
	const raw = process.env.MONGODB_URL;
	if (!raw) throw new Error("MONGODB_URL not configured");
	await mongoose.connect(toTestDbUrl(raw));
	console.log(`Connected: ${mongoose.connection.name}`);

	const app = express();
	app.use(express.json());
	app.use("/community", communityRouter);
	const server = createServer(app);
	await new Promise<void>((r) => server.listen(0, () => r()));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	let n = Date.now() % 100000;
	const mkUser = async () => {
		n += 1;
		return User.create({
			username: `e2e-${n}`,
			phone: `9155${String(n).padStart(6, "0")}`,
			age: 30,
			gender: Gender.Male,
		});
	};
	const mkMembership = (userId: mongoose.Types.ObjectId) =>
		Membership.create({
			user: userId,
			planName: "E2E",
			price: 1,
			status: MembershipStatus.Active,
			startDate: new Date(Date.now() - 86400000),
			endDate: new Date(Date.now() + 30 * 86400000),
		});

	const member = await mkUser();
	await mkMembership(member._id);
	const memberTok = token(member._id.toString(), "user");

	const outsider = await mkUser();
	const outsiderTok = token(outsider._id.toString(), "user");

	// ── 1. Real image upload ──────────────────────────────────────────────────
	section("Image upload → S3 (real round-trip)");
	const img = new Jimp({ width: 640, height: 480, color: 0x3355ffff });
	const jpeg = await img.getBuffer("image/jpeg");
	console.log(`  (generated a real ${jpeg.length}-byte JPEG)`);

	const mkForm = () => {
		const f = new FormData();
		f.append("images", new Blob([jpeg], { type: "image/jpeg" }), "e2e.jpg");
		return f;
	};

	const upRes = await fetch(`${base}/community/media/images`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberTok}` },
		body: mkForm(),
	});
	const up = await upRes.json().catch(() => null);
	check(
		"member upload → 201",
		upRes.status === 201,
		`status=${upRes.status} ${JSON.stringify(up)?.slice(0, 200)}`,
	);
	const image = up?.images?.[0];
	check(
		"response carries url + thumbnail + blurred variants",
		Boolean(image?.url && image?.thumbnailUrl && image?.blurredUrl),
	);
	if (image) {
		for (const k of [
			image.url,
			image.thumbnailUrl,
			image.fullUrl,
			image.blurredUrl,
		]) {
			if (typeof k === "string") createdKeys.push(k);
		}
	}

	const outUp = await fetch(`${base}/community/media/images`, {
		method: "POST",
		headers: { Authorization: `Bearer ${outsiderTok}` },
		body: mkForm(),
	});
	check("outsider upload → 403", outUp.status === 403, `status=${outUp.status}`);

	// ── 2. Create post with the image ─────────────────────────────────────────
	section("Create post with image");
	const created = await api("POST", "/community/posts", memberTok, {
		body: "E2E post with a real image",
		visibility: "public",
		images: image ? [image] : [],
	});
	check(
		"member create post → 201",
		created.status === 201,
		`status=${created.status} ${JSON.stringify(created.json)?.slice(0, 200)}`,
	);
	const postId = created.json?.post?.id;
	check("post id returned", Boolean(postId));

	const mediaRows = await PostMedia.countDocuments({ postId });
	check("PostMedia row persisted", mediaRows === 1, `rows=${mediaRows}`);

	const outCreate = await api("POST", "/community/posts", outsiderTok, {
		body: "should fail",
	});
	check(
		"outsider create post → 403",
		outCreate.status === 403,
		`status=${outCreate.status}`,
	);

	// ── 3. Feed renders it, and the signed URL actually resolves ──────────────
	section("Feed + signed media URL fetch");
	const feed = await api("GET", "/community/feed", memberTok);
	check("member feed → 200", feed.status === 200);
	const row = feed.json?.posts?.find((p: { id: string }) => p.id === postId);
	check("post appears in feed", Boolean(row));
	const mediaUrl = row?.media?.[0]?.url;
	check(
		"feed post carries a media url",
		typeof mediaUrl === "string" && mediaUrl.startsWith("http"),
	);

	if (mediaUrl) {
		const fetched = await fetch(mediaUrl);
		check(
			"signed media URL fetches from S3 → 200",
			fetched.status === 200,
			`status=${fetched.status}`,
		);
		const ct = fetched.headers.get("content-type") ?? "";
		const bytes = Number(fetched.headers.get("content-length") ?? 0);
		check(
			"S3 returned image bytes",
			ct.startsWith("image/") && bytes > 0,
			`type=${ct} bytes=${bytes}`,
		);
	}

	// ── 4. Outsider engagement ────────────────────────────────────────────────
	section("Outsider: view / like / share / comment");
	const outFeed = await api("GET", "/community/feed", outsiderTok);
	check("outsider feed → 200", outFeed.status === 200);
	check(
		"outsider viewer.role = outsider",
		outFeed.json?.viewer?.role === "outsider",
	);

	const outLike = await api(
		"POST",
		`/community/posts/${postId}/like`,
		outsiderTok,
	);
	check(
		"outsider like public post → 200",
		outLike.status === 200,
		`status=${outLike.status}`,
	);
	check("likeCount incremented to 1", outLike.json?.likeCount === 1);

	const outShare = await api(
		"POST",
		`/community/posts/${postId}/share`,
		outsiderTok,
		{ channel: "copy" },
	);
	check(
		"outsider share public post → 200",
		outShare.status === 200,
		`status=${outShare.status}`,
	);
	check(
		"share returns a canonical URL",
		typeof outShare.json?.shareUrl === "string",
	);

	const outComment = await api(
		"POST",
		`/community/posts/${postId}/comments`,
		outsiderTok,
		{ body: "no" },
	);
	check(
		"outsider comment → 403",
		outComment.status === 403,
		`status=${outComment.status}`,
	);

	// ── 5. Member owns their post ─────────────────────────────────────────────
	section("Member: comment / edit own / delete own");
	const memComment = await api(
		"POST",
		`/community/posts/${postId}/comments`,
		memberTok,
		{ body: "mine" },
	);
	check(
		"member comment → 201",
		memComment.status === 201,
		`status=${memComment.status}`,
	);

	const edit = await api("PATCH", `/community/posts/${postId}`, memberTok, {
		body: "edited by author",
	});
	check("author edits own post → 200", edit.status === 200, `status=${edit.status}`);
	check("edited flag true", edit.json?.post?.edited === true);

	const stranger = await mkUser();
	await mkMembership(stranger._id);
	const strangerTok = token(stranger._id.toString(), "user");
	const strangerEdit = await api(
		"PATCH",
		`/community/posts/${postId}`,
		strangerTok,
		{ body: "hijack" },
	);
	check(
		"another member edits it → 403",
		strangerEdit.status === 403,
		`status=${strangerEdit.status}`,
	);
	const strangerDel = await api(
		"DELETE",
		`/community/posts/${postId}`,
		strangerTok,
	);
	check(
		"another member deletes it → 403",
		strangerDel.status === 403,
		`status=${strangerDel.status}`,
	);

	const del = await api("DELETE", `/community/posts/${postId}`, memberTok);
	check("author deletes own post → 200", del.status === 200, `status=${del.status}`);
	const gone = await api("GET", `/community/posts/${postId}`, memberTok);
	check("deleted post → 404", gone.status === 404, `status=${gone.status}`);

	server.close();
}

async function main(): Promise<void> {
	console.log("================================================================");
	console.log("  COMMUNITY E2E — UPLOAD / VIEW / LIKE / SHARE / OWNERSHIP");
	console.log("================================================================");
	try {
		await run();
	} catch (e) {
		console.error("\n[CRITICAL]", e);
		failed++;
	} finally {
		for (const key of createdKeys) {
			try {
				await deleteFromS3(key);
			} catch {}
		}
		console.log(`\n(cleaned up ${createdKeys.length} S3 objects)`);
		try {
			await mongoose.connection.dropDatabase();
		} catch {}
		await mongoose.disconnect();
	}
	console.log("\n================================================================");
	console.log(
		`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`,
	);
	console.log("================================================================");
	process.exit(failed === 0 ? 0 : 1);
}

main();
