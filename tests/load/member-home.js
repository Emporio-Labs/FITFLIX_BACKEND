import { group, sleep } from "k6";
import { Trend } from "k6/metrics";
import {
	assertSafeTarget,
	P95_MS,
	timedGet,
} from "./lib/common.js";

/**
 * FX-26.1 — the member home screen under load.
 *
 * Mirrors what the member app fetches when the home screen opens: the class
 * catalogue, live promotions and the member's in-app notification inbox. Each
 * is recorded on its own trend so the summary prints a per-screen p95 (FX-26.2).
 *
 * Needs a MEMBER token: -e MEMBER_TOKEN=<jwt>. Optionally -e LOCATION_ID=<id>.
 */

const MEMBER_TOKEN = __ENV.MEMBER_TOKEN || "";
const classes = new Trend("home_classes_ms", true);
const promotions = new Trend("home_promotions_ms", true);
const inbox = new Trend("home_notifications_ms", true);

const VUS = Number(__ENV.VUS || 25);

export const options = {
	scenarios: {
		member_home: {
			executor: "ramping-vus",
			startVUs: 0,
			stages: [
				{ duration: __ENV.RAMP || "30s", target: VUS },
				{ duration: __ENV.HOLD || "1m", target: VUS },
				{ duration: "15s", target: 0 },
			],
		},
	},
	thresholds: {
		home_classes_ms: [`p(95)<${P95_MS}`],
		home_promotions_ms: [`p(95)<${P95_MS}`],
		home_notifications_ms: [`p(95)<${P95_MS}`],
		http_req_failed: ["rate<0.01"],
	},
};

export function setup() {
	return assertSafeTarget();
}

export default function (data) {
	group("member home", () => {
		timedGet(classes, `${data.baseUrl}/api/v1/classes`, MEMBER_TOKEN);
		timedGet(promotions, `${data.baseUrl}/promotions`, MEMBER_TOKEN);
		// The member's own inbox (in-app delivery of club announcements, FX-20.3).
		timedGet(inbox, `${data.baseUrl}/notifications`, MEMBER_TOKEN);
	});
	sleep(1);
}
