import { group, sleep } from "k6";
import { Trend } from "k6/metrics";
import { assertSafeTarget, P95_MS, timedGet } from "./lib/common.js";

/**
 * FX-26.1 — the class-booking screen under load.
 *
 * Mirrors what the member app fetches to browse and book: the dated session
 * feed (today onward) plus the class catalogue it drills into. Both carry the
 * FX-20.2 home-club visibility rule, so this also exercises that filter at load.
 *
 * Needs a MEMBER token: -e MEMBER_TOKEN=<jwt>. Optionally -e LOCATION_ID=<id>.
 */

const MEMBER_TOKEN = __ENV.MEMBER_TOKEN || "";
const schedule = new Trend("booking_schedule_ms", true);
const catalogue = new Trend("booking_classes_ms", true);

const VUS = Number(__ENV.VUS || 25);

export const options = {
	scenarios: {
		class_booking: {
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
		booking_schedule_ms: [`p(95)<${P95_MS}`],
		booking_classes_ms: [`p(95)<${P95_MS}`],
		http_req_failed: ["rate<0.01"],
	},
};

export function setup() {
	return assertSafeTarget();
}

export default function (data) {
	group("class booking", () => {
		timedGet(schedule, `${data.baseUrl}/api/v1/classes/schedule`, MEMBER_TOKEN);
		timedGet(catalogue, `${data.baseUrl}/api/v1/classes`, MEMBER_TOKEN);
	});
	sleep(1);
}
