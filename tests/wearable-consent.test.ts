/**
 * Pure-function coverage for the wearable consent gate
 * (utils/wearable-consent.ts). No server, no database.
 *
 * Written as the rules themselves: a refactor that still passes these has
 * kept the rules.
 */
import {
	isEligibleForWearables,
	mayStaffViewWearableData,
	mayStoreWearableData,
} from "../src/utils/wearable-consent";
import { assert } from "./test-helpers";

const NOW = new Date("2026-11-17T12:00:00Z");
const adult = { dateOfBirth: new Date("1995-03-10") };
const minor = { dateOfBirth: new Date("2010-06-01") };

console.log("\n🔎 Storing wearable data");
assert(
	mayStoreWearableData(
		{ ...adult, healthDataConsent: { wearableSync: true } },
		NOW,
	).allowed,
	"an adult who switched sync on may sync",
);
assert(
	!mayStoreWearableData(adult, NOW).allowed,
	"no consent block at all is refusal, not a default yes",
);
assert(
	!mayStoreWearableData(
		{ ...adult, healthDataConsent: { wearableSync: null } },
		NOW,
	).allowed,
	"a null switch is refusal",
);
{
	const d = mayStoreWearableData(
		{ ...minor, healthDataConsent: { wearableSync: true } },
		NOW,
	);
	assert(
		!d.allowed && d.reason === "minor",
		"a minor is refused even with consent",
	);
}
{
	const d = mayStoreWearableData(
		{ healthDataConsent: { wearableSync: true } },
		NOW,
	);
	assert(
		!d.allowed && d.reason === "unknown_age",
		"an unknown age is refused, not assumed adult",
	);
}

console.log("\n🔎 Staff (coach) visibility");
assert(
	mayStaffViewWearableData(
		{ ...adult, healthDataConsent: { wearableSync: true, coachSharing: true } },
		NOW,
	).allowed,
	"sync + sharing lets the coach see it",
);
assert(
	!mayStaffViewWearableData(
		{
			...adult,
			healthDataConsent: { wearableSync: true, coachSharing: false },
		},
		NOW,
	).allowed,
	"syncing alone is not permission to share",
);
assert(
	!mayStaffViewWearableData(
		{
			...adult,
			healthDataConsent: { wearableSync: false, coachSharing: true },
		},
		NOW,
	).allowed,
	"sharing without syncing grants nothing",
);
assert(
	!mayStaffViewWearableData(
		{ ...minor, healthDataConsent: { wearableSync: true, coachSharing: true } },
		NOW,
	).allowed,
	"a minor's data is never shown to staff",
);

console.log("\n🔎 Eligibility (for the app's UI)");
assert(isEligibleForWearables(adult, NOW), "adults are eligible");
assert(!isEligibleForWearables(minor, NOW), "minors are not");
assert(!isEligibleForWearables({}, NOW), "unknown age is not");

console.log("\nAll wearable consent checks passed.");
// test-helpers pulls in the app (schedulers, sockets), so exit explicitly.
process.exit(0);
