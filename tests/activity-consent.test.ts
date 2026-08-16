/**
 * Pure-function coverage for the behaviour-tracking consent gate
 * (utils/activity-consent.ts). No server, no database.
 *
 * This is the module that decides whether recording someone's behaviour is
 * lawful, so the assertions are written as the rules themselves rather than as
 * code paths: a refactor that still passes these has kept the rules.
 */
import {
	mayRecordBehaviour,
	MINOR_AGE_THRESHOLD,
	resolveAge,
} from "../src/utils/activity-consent";
import { assert } from "./test-helpers";

const consenting = { behaviouralTracking: true };
const NOW = new Date("2026-08-16T12:00:00Z");

const yearsAgo = (years: number, month = 0, day = 1) =>
	new Date(Date.UTC(NOW.getUTCFullYear() - years, month, day));

function runUnitTests() {
	console.log("\n🔎 Age resolution");
	{
		assert(
			resolveAge({ dateOfBirth: yearsAgo(30), age: 5 }, NOW) === 30,
			"date of birth wins over the stored age, which rots after signup",
		);
		assert(
			resolveAge({ age: 25 }, NOW) === 25,
			"the stored age is used when there is no date of birth",
		);
		assert(
			resolveAge({}, NOW) === null,
			"no age information at all resolves to null, not to a guess",
		);
		assert(
			resolveAge({ dateOfBirth: new Date("nope") as Date, age: 40 }, NOW) === 40,
			"an unparseable date of birth falls back rather than throwing",
		);

		// Born 18 years ago in December; in August they are still 17.
		assert(
			resolveAge({ dateOfBirth: yearsAgo(18, 11, 25) }, NOW) === 17,
			"a birthday later this year has not happened yet",
		);
		assert(
			resolveAge({ dateOfBirth: yearsAgo(18, 0, 1) }, NOW) === 18,
			"a birthday earlier this year has happened",
		);
	}

	console.log("\n🔎 Children are never tracked, consent or not");
	{
		const minor = { age: MINOR_AGE_THRESHOLD - 1, privacyConsent: consenting };
		const decision = mayRecordBehaviour(minor, NOW);
		assert(
			!decision.allowed && decision.reason === "minor",
			"an under-18 is refused even with tracking consent granted",
		);
		assert(
			!mayRecordBehaviour(
				{ dateOfBirth: yearsAgo(12), privacyConsent: consenting },
				NOW,
			).allowed,
			"the age check uses date of birth too, not only the stored age",
		);
		assert(
			mayRecordBehaviour(
				{ age: MINOR_AGE_THRESHOLD, privacyConsent: consenting },
				NOW,
			).allowed,
			"exactly 18 is an adult",
		);
	}

	console.log("\n🔎 Absence is refusal");
	{
		const cases: Array<[string, Parameters<typeof mayRecordBehaviour>[0]]> = [
			["no privacyConsent block at all", { age: 30 }],
			["an empty privacyConsent block", { age: 30, privacyConsent: {} }],
			[
				"tracking explicitly declined",
				{ age: 30, privacyConsent: { behaviouralTracking: false } },
			],
			[
				"a null consent value",
				{ age: 30, privacyConsent: { behaviouralTracking: null } },
			],
			["a null privacyConsent", { age: 30, privacyConsent: null }],
		];
		for (const [label, subject] of cases) {
			const d = mayRecordBehaviour(subject, NOW);
			assert(
				!d.allowed && d.reason === "no_consent",
				`${label} is refused`,
			);
		}

		const unknown = mayRecordBehaviour({ privacyConsent: consenting }, NOW);
		assert(
			!unknown.allowed && unknown.reason === "unknown_age",
			"not knowing someone's age is not permission to profile them",
		);
	}

	console.log("\n🔎 The one allowed case");
	{
		assert(
			mayRecordBehaviour({ age: 30, privacyConsent: consenting }, NOW).allowed,
			"a consenting adult is recorded",
		);
		assert(
			mayRecordBehaviour(
				{ dateOfBirth: yearsAgo(30), privacyConsent: consenting },
				NOW,
			).allowed,
			"a consenting adult identified by date of birth is recorded",
		);
	}

	console.log("\n🎉 Activity Consent Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Activity consent unit test failed:", err);
	process.exit(1);
}
