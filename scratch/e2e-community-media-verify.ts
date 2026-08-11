/**
 * Verifies the audio + video halves of the community media contract — the
 * parts the app's composer now depends on and that e2e-community-verify.ts
 * (images only) never touches.
 *
 * Asserts the exact shapes the Flutter client parses:
 *   POST /community/media/audio          → { audio: { url, previewUrl, duration } }
 *   POST /community/media/video/presign  → { uploadUrl, s3Key, contentType }
 *   POST /community/posts { audio, video } and the feed rows that come back.
 *
 * Runs against <db>_community_test with a real S3 round-trip.
 *   bun run scratch/e2e-community-media-verify.ts
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { config } from "dotenv";
import express from "express";
import mongoose from "mongoose";
import { Gender, MembershipStatus } from "../src/models/Enums";
import Membership from "../src/models/Membership";
import User from "../src/models/User";
import communityRouter from "../src/routes/community.routes";
import type { AppUserRole } from "../src/types/auth";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";

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

/**
 * A structurally valid MP3: an ID3v2.4 header (which is what the server's
 * magic-byte check looks for) followed by silent MPEG-1 Layer III frames.
 * The server never decodes audio — it validates the signature, the size, and
 * the client-declared duration — so this exercises the real code path.
 */
function makeMp3(frames: number): Buffer {
	const id3 = Buffer.from([
		0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	]);
	// 0xFF 0xFB = frame sync + MPEG-1 + Layer III; 0x90 0x00 = 128kbps, 44.1kHz.
	const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
	const frame = Buffer.concat([header, Buffer.alloc(413)]);
	return Buffer.concat([id3, ...Array.from({ length: frames }, () => frame)]);
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
			username: `media-${n}`,
			phone: `9166${String(n).padStart(6, "0")}`,
			age: 30,
			gender: Gender.Male,
		});
	};

	const member = await mkUser();
	await Membership.create({
		user: member._id,
		planName: "MEDIA-E2E",
		price: 1,
		status: MembershipStatus.Active,
		startDate: new Date(Date.now() - 86400000),
		endDate: new Date(Date.now() + 30 * 86400000),
	});
	const memberTok = token(member._id.toString(), "user");
	const outsider = await mkUser();
	const outsiderTok = token(outsider._id.toString(), "user");

	// ── 1. Audio upload ───────────────────────────────────────────────────────
	section("Audio upload → S3");
	const mp3 = makeMp3(120);
	console.log(`  (generated a ${mp3.length}-byte MP3)`);

	const audioForm = new FormData();
	audioForm.append("audio", new Blob([mp3], { type: "audio/mpeg" }), "clip.mp3");
	audioForm.append("duration", "42");

	const aRes = await fetch(`${base}/community/media/audio`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberTok}` },
		body: audioForm,
	});
	const aJson = await aRes.json().catch(() => null);
	check(
		"member audio upload → 201",
		aRes.status === 201,
		`status=${aRes.status} ${JSON.stringify(aJson)?.slice(0, 300)}`,
	);
	const audio = aJson?.audio;
	check("response carries url + duration", Boolean(audio?.url && audio?.duration));
	check(
		"previewUrl is a signed, playable URL",
		typeof audio?.previewUrl === "string" && audio.previewUrl.startsWith("http"),
	);
	check("declared duration echoed back", audio?.duration === 42);

	if (audio?.previewUrl) {
		const fetched = await fetch(audio.previewUrl);
		check("previewUrl fetches from S3 → 200", fetched.status === 200);
	}

	// Duration cap is enforced against the client-declared value.
	const longForm = new FormData();
	longForm.append("audio", new Blob([mp3], { type: "audio/mpeg" }), "clip.mp3");
	longForm.append("duration", "9999");
	const longRes = await fetch(`${base}/community/media/audio`, {
		method: "POST",
		headers: { Authorization: `Bearer ${memberTok}` },
		body: longForm,
	});
	check(
		"over-long declared duration rejected",
		longRes.status >= 400 && longRes.status < 500,
		`status=${longRes.status}`,
	);

	const outAudioForm = new FormData();
	outAudioForm.append("audio", new Blob([mp3], { type: "audio/mpeg" }), "c.mp3");
	outAudioForm.append("duration", "10");
	const outARes = await fetch(`${base}/community/media/audio`, {
		method: "POST",
		headers: { Authorization: `Bearer ${outsiderTok}` },
		body: outAudioForm,
	});
	check("outsider audio upload → 403", outARes.status === 403);

	// ── 2. Video presign → direct S3 PUT ──────────────────────────────────────
	section("Video presign → direct PUT to S3");
	const videoBytes = Buffer.concat([
		Buffer.from([0x00, 0x00, 0x00, 0x20]),
		Buffer.from("ftypisom"),
		Buffer.alloc(4096),
	]);

	const presign = await api("POST", "/community/media/video/presign", memberTok, {
		filename: "demo.mp4",
		contentType: "video/mp4",
		contentLength: videoBytes.length,
	});
	check(
		"presign → 201",
		presign.status === 201,
		`status=${presign.status} ${JSON.stringify(presign.json)?.slice(0, 300)}`,
	);
	check(
		"presign carries uploadUrl + s3Key + contentType",
		Boolean(
			presign.json?.uploadUrl &&
				presign.json?.s3Key &&
				presign.json?.contentType,
		),
	);

	let videoUploaded = false;
	if (presign.json?.uploadUrl) {
		// A PUT carrying only Content-Type is what both clients used to send,
		// and S3 rejects it: the presign signs content-disposition and
		// x-amz-server-side-encryption too. Pin the failure so nobody
		// "simplifies" those headers away again.
		const bare = await fetch(presign.json.uploadUrl, {
			method: "PUT",
			headers: { "Content-Type": presign.json.contentType },
			body: videoBytes,
		});
		check(
			"PUT missing the signed headers → 403 (regression guard)",
			bare.status === 403,
			`status=${bare.status}`,
		);

		// Exactly what the clients send now: every signed header replayed.
		const put = await fetch(presign.json.uploadUrl, {
			method: "PUT",
			headers: {
				"Content-Type": presign.json.contentType,
				"Content-Disposition": "inline",
				"x-amz-server-side-encryption": "AES256",
			},
			body: videoBytes,
		});
		videoUploaded = put.ok;
		check("direct PUT to S3 → 2xx", put.ok, `status=${put.status}`);
	}

	const outPresign = await api(
		"POST",
		"/community/media/video/presign",
		outsiderTok,
		{ filename: "x.mp4", contentType: "video/mp4", contentLength: 100 },
	);
	check("outsider presign → 403", outPresign.status === 403);

	const badType = await api(
		"POST",
		"/community/media/video/presign",
		memberTok,
		{ filename: "x.avi", contentType: "video/x-msvideo", contentLength: 100 },
	);
	check(
		"unsupported video type rejected",
		badType.status >= 400 && badType.status < 500,
		`status=${badType.status}`,
	);

	// ── 3. Post carrying audio + video ────────────────────────────────────────
	section("Create post with audio + video");
	const created = await api("POST", "/community/posts", memberTok, {
		body: "Demo post with a clip and a video.",
		visibility: "public",
		audio: audio ? [{ url: audio.url, duration: audio.duration }] : [],
		...(videoUploaded ? { video: { s3Key: presign.json.s3Key } } : {}),
	});
	check(
		"create post → 201",
		created.status === 201,
		`status=${created.status} ${JSON.stringify(created.json)?.slice(0, 400)}`,
	);
	const postId = created.json?.post?.id;
	check("post id returned", Boolean(postId));

	// ── 4. Feed rows are what the app parses ──────────────────────────────────
	section("Feed → media rows the client can render");
	const feed = await api("GET", "/community/feed", memberTok);
	check("feed → 200", feed.status === 200);
	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
	const post = feed.json?.posts?.find((p: any) => p.id === postId);
	check("post appears in feed", Boolean(post));

	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
	const media: any[] = post?.media ?? [];
	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
	const audioRow = media.find((m: any) => m.kind === "audio");
	// biome-ignore lint/suspicious/noExplicitAny: throwaway verification client
	const videoRow = media.find((m: any) => m.kind === "video");

	check("feed carries an audio row (kind=audio)", Boolean(audioRow));
	check(
		"audio row carries duration the player needs",
		audioRow?.duration === 42,
		`duration=${audioRow?.duration}`,
	);
	check(
		"audio row url is signed and playable",
		typeof audioRow?.url === "string" && audioRow.url.startsWith("http"),
	);
	if (audioRow?.url) {
		const played = await fetch(audioRow.url);
		check("audio row url streams from S3 → 200", played.status === 200);
	}

	if (videoUploaded) {
		check("feed carries a video row (kind=video)", Boolean(videoRow));
		check(
			"video row url is signed",
			typeof videoRow?.url === "string" && videoRow.url.startsWith("http"),
		);
		if (videoRow?.url) {
			const streamed = await fetch(videoRow.url);
			check("video row url streams from S3 → 200", streamed.status === 200);
		}
	}

	// The app splits media by kind; a post with both must not collapse them.
	check(
		"audio and video are distinct rows, not merged",
		Boolean(audioRow && videoRow) && audioRow.id !== videoRow.id,
	);

	await api("DELETE", `/community/posts/${postId}`, memberTok);
	await mongoose.connection.dropDatabase();
	await mongoose.disconnect();
	server.close();
}

run()
	.then(() => {
		console.log(`\n${"=".repeat(64)}`);
		console.log(
			`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`,
		);
		console.log("=".repeat(64));
		process.exit(failed === 0 ? 0 : 1);
	})
	.catch((err) => {
		console.error("\nFATAL", err);
		process.exit(1);
	});
