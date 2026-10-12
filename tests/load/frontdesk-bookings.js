import { group, sleep } from "k6";
import { Trend } from "k6/metrics";
import { assertSafeTarget, P95_MS, timedGet } from "./lib/common.js";

/**
 * FX-26.1 — the Front-desk bookings list under load.
 *
 * Exercises both shapes of GET /bookings: the default (full branch-scoped list,
 * the way the staff console calls it today) and the opt-in paginated page added
 * for FX-26. Comparing the two trends shows what pagination buys as the
 * bookings collection grows.
 *
 * Needs a STAFF token (admin/frontdesk): -e STAFF_TOKEN=<jwt>.
 * Optionally -e LOCATION_ID=<id> to scope to one branch.
 */

const STAFF_TOKEN = __ENV.STAFF_TOKEN || "";
const fullList = new Trend("frontdesk_bookings_full_ms", true);
const pagedList = new Trend("frontdesk_bookings_paged_ms", true);

const VUS = Number(__ENV.VUS || 15);
const PAGE_LIMIT = Number(__ENV.PAGE_LIMIT || 50);

export const options = {
	scenarios: {
		frontdesk_bookings: {
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
		// The paginated page is the one that must stay fast as data grows; the full
		// list is tracked for comparison and has a looser budget.
		frontdesk_bookings_paged_ms: [`p(95)<${P95_MS}`],
		frontdesk_bookings_full_ms: [`p(95)<${P95_MS * 4}`],
		http_req_failed: ["rate<0.01"],
	},
};

export function setup() {
	return assertSafeTarget();
}

export default function (data) {
	group("front-desk bookings", () => {
		timedGet(fullList, `${data.baseUrl}/bookings`, STAFF_TOKEN);
		timedGet(
			pagedList,
			`${data.baseUrl}/bookings?page=1&limit=${PAGE_LIMIT}`,
			STAFF_TOKEN,
		);
	});
	sleep(1);
}
