/**
 * Post-deploy smoke test for the community module.
 *
 *   bun run scripts/community-smoke.ts --base https://staging.example.com
 *
 * Read-only and unauthenticated by design: it asserts that the *guards* are in
 * place (401/403 where they must be) rather than exercising writes against a
 * live database. Optionally pass --token <memberJwt> to also check the feed
 * responds for an authenticated member.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const BASE = (flag("base") ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000")
	.replace(/\/$/, "");
const TOKEN = flag("token");

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = ""): void {
	if (ok) {
		passed += 1;
		console.log(`  PASS  ${label}`);
	} else {
		failed += 1;
		console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

async function hit(
	path: string,
	init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
	try {
		const res = await fetch(`${BASE}${path}`, init);
		let body: unknown = null;
		try {
			body = await res.json();
		} catch {
			body = null;
		}
		return { status: res.status, body };
	} catch (error) {
		return { status: 0, body: { error: String(error) } };
	}
}

const codeOf = (body: unknown): string =>
	(body as { code?: string } | null)?.code ?? "";

async function main(): Promise<void> {
	console.log("================================================================");
	console.log(`  FITFLIX COMMUNITY — SMOKE TEST`);
	console.log(`  target: ${BASE}`);
	console.log("================================================================\n");

	console.log("── Liveness ──");
	const health = await hit("/health");
	check(
		"GET /health → 200 { ok: true }",
		health.status === 200 && (health.body as { ok?: boolean })?.ok === true,
		`status=${health.status}`,
	);

	console.log("\n── Member surface ──");
	const anonFeed = await hit("/community/feed");
	check(
		"GET /community/feed unauthenticated → 401",
		anonFeed.status === 401,
		`status=${anonFeed.status}`,
	);

	if (TOKEN) {
		const feed = await hit("/community/feed", {
			headers: { authorization: `Bearer ${TOKEN}` },
		});
		check(
			"GET /community/feed with member token → 200",
			feed.status === 200,
			`status=${feed.status}`,
		);
		const posts = (feed.body as { posts?: unknown[] } | null)?.posts;
		check("feed returned a posts array", Array.isArray(posts));
	} else {
		console.log("  SKIP  authenticated feed check (no --token supplied)");
	}

	console.log("\n── Admin surface is guarded ──");
	const anonAdmin = await hit("/community/admin/posts");
	check(
		"GET /community/admin/posts unauthenticated → 401",
		anonAdmin.status === 401,
		`status=${anonAdmin.status}`,
	);

	if (TOKEN) {
		// A member token must be rejected as forbidden, not merely unauthorized.
		const memberAdmin = await hit("/community/admin/posts", {
			headers: { authorization: `Bearer ${TOKEN}` },
		});
		check(
			"member token → admin route → 403",
			memberAdmin.status === 403,
			`status=${memberAdmin.status}`,
		);
	}

	const stepUp = await hit("/community/admin/step-up", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ password: "not-a-real-password" }),
	});
	check(
		"POST /community/admin/step-up unauthenticated → 401",
		stepUp.status === 401,
		`status=${stepUp.status}`,
	);

	console.log("\n── CORS preflight allows the step-up header ──");
	const preflight = await fetch(`${BASE}/community/admin/posts`, {
		method: "OPTIONS",
	}).catch(() => null);
	const allowHeaders = preflight?.headers.get("access-control-allow-headers") ?? "";
	check(
		"Access-Control-Allow-Headers includes X-Step-Up-Token",
		allowHeaders.toLowerCase().includes("x-step-up-token"),
		allowHeaders || "no header returned",
	);

	console.log("\n── Security headers ──");
	const headers = (await fetch(`${BASE}/health`).catch(() => null))?.headers;
	check(
		"X-Content-Type-Options: nosniff",
		headers?.get("x-content-type-options") === "nosniff",
	);
	check("X-Frame-Options: DENY", headers?.get("x-frame-options") === "DENY");

	// Surface any unexpected code so a guard that fails for the *wrong* reason
	// (e.g. a 401 from a crashed router) is visible rather than counted as a pass.
	const codes = [anonAdmin, stepUp].map((r) => codeOf(r.body)).filter(Boolean);
	if (codes.length > 0) {
		console.log(`\n  note: guard codes seen → ${codes.join(", ")}`);
	}

	console.log("\n================================================================");
	console.log(
		`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`,
	);
	console.log("================================================================");
	process.exit(failed === 0 ? 0 : 1);
}

main();
