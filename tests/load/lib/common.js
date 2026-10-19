import http from "k6/http";
import { check } from "k6";

/**
 * FX-26 load-test shared helpers: target resolution, the production guard
 * (FX-26.4), auth headers and a per-endpoint timing recorder.
 *
 * Run with the k6 CLI (https://k6.io) — a standalone binary, not an npm dep:
 *   k6 run -e BASE_URL=http://localhost:3000 -e MEMBER_TOKEN=... tests/load/member-home.js
 *
 * See tests/load/README.md for the full matrix and how to point it at a
 * restored COPY of production.
 */

const BASE_URL = (__ENV.BASE_URL || "").replace(/\/+$/, "");
const MEMBER_TOKEN = __ENV.MEMBER_TOKEN || "";
const STAFF_TOKEN = __ENV.STAFF_TOKEN || "";
const LOCATION_ID = __ENV.LOCATION_ID || "";
const CONFIRM = __ENV.LOAD_TEST_CONFIRM || "";

// Default p95 budget (ms) per screen; override with -e P95_MS=…
export const P95_MS = Number(__ENV.P95_MS || 500);

// Substrings that mark a host as production. Extend per deployment with
// -e PROD_HOSTS="api.example.com,live.example.com".
const DEFAULT_PROD_PATTERNS = [
	"fitflix.in",
	"fitflix.com",
	"api.fitflix",
	"prod",
	"production",
];
const EXTRA_PROD = (__ENV.PROD_HOSTS || "")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);
const PROD_PATTERNS = [...DEFAULT_PROD_PATTERNS, ...EXTRA_PROD];

const hostOf = (url) => {
	try {
		return new URL(url).host.toLowerCase();
	} catch (_e) {
		return "";
	}
};

// localhost / loopback / RFC-1918 private ranges / internal TLDs are always
// treated as non-production and need no confirmation.
const isLocalHost = (host) =>
	/^(localhost|127\.|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
		host,
	) ||
	host.endsWith(".local") ||
	host.endsWith(".internal") ||
	host.endsWith(".test");

/**
 * FX-26.4 — refuse to run against production, and require an explicit
 * acknowledgement for any non-local target (so a prod *copy* is a deliberate
 * choice, never a typo that hits the live API). Call from each scenario's
 * setup() so k6 aborts before generating load.
 */
export function assertSafeTarget() {
	if (!BASE_URL) {
		throw new Error(
			"BASE_URL is required, e.g. -e BASE_URL=http://localhost:3000",
		);
	}
	const host = hostOf(BASE_URL);
	const local = isLocalHost(host);
	const looksProd = PROD_PATTERNS.some((p) => p && host.includes(p));

	if (looksProd && !local) {
		throw new Error(
			`Refusing to load-test "${host}" — it matches a production host (FX-26.4). ` +
				"Point BASE_URL at a restored COPY of production instead.",
		);
	}
	if (!local && CONFIRM !== "prod-copy") {
		throw new Error(
			`BASE_URL "${host}" is not a local/private host. If this is a restored COPY of ` +
				"production (never production itself), set -e LOAD_TEST_CONFIRM=prod-copy to proceed (FX-26.4).",
		);
	}
	return { baseUrl: BASE_URL };
}

const headers = (token) => {
	const h = { "Content-Type": "application/json" };
	if (token) h.Authorization = `Bearer ${token}`;
	if (LOCATION_ID) h["X-Location-Id"] = LOCATION_ID;
	return h;
};

export const memberHeaders = () => headers(MEMBER_TOKEN);
export const staffHeaders = () => headers(STAFF_TOKEN);

/**
 * GET a URL, record its duration on `trend` (so the summary reports a per-screen
 * p95, FX-26.2) and assert a 200. Returns the response for further checks.
 */
export function timedGet(trend, url, token) {
	const res = http.get(url, { headers: headers(token) });
	trend.add(res.timings.duration);
	check(res, {
		[`200 ${url}`]: (r) => r.status === 200,
	});
	return res;
}
