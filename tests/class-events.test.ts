/**
 * Pure-function coverage for classes-as-events (C1).
 *
 * Two things are covered here: the batch enrolment window
 * (utils/class-enrollment.ts) and the event-field integrity rules in
 * validators/class.validator.ts. Both are pure — no server, no database.
 *
 * The most important assertion in this file is section 1: every class already
 * in the database predates the `format` field, so `undefined` must read as
 * drop-in. If that ever regresses, every existing class silently changes
 * booking behaviour at once.
 */
import {
	evaluateEnrollmentWindow,
	isBatchClass,
} from "../src/utils/class-enrollment";
import {
	createClassBodySchema,
	eventFieldsSchema,
	pickEventFields,
	updateClassBodySchema,
} from "../src/validators/class.validator";
import { assert } from "./test-helpers";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-08-16T12:00:00.000Z");
const ago = (d: number) => new Date(now.getTime() - d * day);
const ahead = (d: number) => new Date(now.getTime() + d * day);

/** A create payload that passes, so each test varies one thing at a time. */
const baseClass = {
	name: "Sunrise Strength",
	creditCost: 2,
};

function runUnitTests() {
	console.log("=== Unit Test: Classes as Events (C1) ===");

	console.log("\n1. Existing classes are untouched — the regression guarantee...");
	{
		assert(
			isBatchClass({}) === false,
			"a class with no format field at all reads as drop-in",
		);
		assert(
			isBatchClass({ format: null }) === false,
			"an explicitly null format reads as drop-in",
		);
		assert(
			isBatchClass(undefined) === false,
			"an absent class reads as drop-in rather than throwing",
		);
		assert(
			isBatchClass({ format: "drop_in" }) === false,
			"an explicit drop_in reads as drop-in",
		);
		assert(
			isBatchClass({ format: "batch" }) === true,
			"only an explicit batch takes the cohort path",
		);

		const parsed = createClassBodySchema.safeParse(baseClass);
		assert(parsed.success, "a class created without any event fields is valid");
		if (parsed.success) {
			assert(
				parsed.data.format === "drop_in",
				"format defaults to drop_in, so existing callers keep their behaviour",
			);
			assert(
				parsed.data.startDate === null && parsed.data.endDate === null,
				"an unbounded run stays null by default",
			);
			assert(parsed.data.imageUrl === "", "imageUrl defaults to empty");
		}
	}

	console.log("\n2. The batch enrolment window...");
	{
		const openBatch = {
			format: "batch" as const,
			startDate: ahead(3),
			endDate: ahead(30),
			enrollmentOpensAt: ago(2),
			enrollmentClosesAt: ahead(2),
		};

		assert(
			evaluateEnrollmentWindow(openBatch, now).allowed,
			"a batch inside its enrolment window is joinable",
		);

		const notOpen = evaluateEnrollmentWindow(
			{ ...openBatch, enrollmentOpensAt: ahead(1) },
			now,
		);
		assert(!notOpen.allowed, "a batch whose enrolment has not opened is refused");
		assert(
			notOpen.code === "ENROLLMENT_NOT_OPEN",
			"…with ENROLLMENT_NOT_OPEN",
		);

		const closed = evaluateEnrollmentWindow(
			{ ...openBatch, enrollmentClosesAt: ago(1) },
			now,
		);
		assert(!closed.allowed, "a batch past its enrolment close is refused");
		assert(closed.code === "ENROLLMENT_CLOSED", "…with ENROLLMENT_CLOSED");

		// The run ending is an implicit close even with no explicit close date.
		const ended = evaluateEnrollmentWindow(
			{
				format: "batch",
				startDate: ago(30),
				endDate: ago(1),
				enrollmentOpensAt: ago(40),
				enrollmentClosesAt: null,
			},
			now,
		);
		assert(!ended.allowed, "a finished run cannot be joined without an explicit close");
		assert(ended.code === "BATCH_ENDED", "…with BATCH_ENDED");
	}

	console.log("\n3. Enrolment bounds are inclusive...");
	{
		assert(
			evaluateEnrollmentWindow(
				{ format: "batch", enrollmentOpensAt: new Date(now), endDate: ahead(5) },
				now,
			).allowed,
			"enrolment opening exactly now is joinable",
		);
		assert(
			evaluateEnrollmentWindow(
				{ format: "batch", enrollmentClosesAt: new Date(now), endDate: ahead(5) },
				now,
			).allowed,
			"enrolment closing exactly now is still joinable",
		);
	}

	console.log("\n4. Every bound is optional and skipped when absent...");
	{
		assert(
			evaluateEnrollmentWindow({ format: "batch" }, now).allowed,
			"a batch with no window configured at all is open",
		);
		assert(
			evaluateEnrollmentWindow(
				{ format: "batch", enrollmentOpensAt: ago(1) },
				now,
			).allowed,
			"an open date with no close is open-ended",
		);
	}

	console.log("\n5. Dates survive arriving as ISO strings off the wire...");
	{
		const decision = evaluateEnrollmentWindow(
			{
				format: "batch",
				enrollmentOpensAt: ahead(1).toISOString(),
				endDate: ahead(9).toISOString(),
			},
			now,
		);
		assert(
			!decision.allowed && decision.code === "ENROLLMENT_NOT_OPEN",
			"an ISO string is parsed, not silently treated as absent",
		);

		assert(
			evaluateEnrollmentWindow(
				{ format: "batch", enrollmentOpensAt: "not-a-date" },
				now,
			).allowed,
			"an unparseable date is ignored rather than blocking every enrolment",
		);
	}

	console.log("\n6. A batch must declare its run...");
	{
		const missingDates = createClassBodySchema.safeParse({
			...baseClass,
			format: "batch",
		});
		assert(!missingDates.success, "a batch with no startDate or endDate is rejected");
		if (!missingDates.success) {
			const paths = missingDates.error.issues.map((i) => String(i.path[0]));
			assert(paths.includes("startDate"), "…the error names startDate");
			assert(paths.includes("endDate"), "…and endDate");
		}

		const good = createClassBodySchema.safeParse({
			...baseClass,
			format: "batch",
			startDate: ahead(3).toISOString(),
			endDate: ahead(30).toISOString(),
			enrollmentOpensAt: now.toISOString(),
			enrollmentClosesAt: ahead(2).toISOString(),
		});
		assert(good.success, "a fully specified batch is valid");
	}

	console.log("\n7. A drop-in cannot carry event fields...");
	{
		const contradictory = createClassBodySchema.safeParse({
			...baseClass,
			format: "drop_in",
			startDate: ahead(3).toISOString(),
		});
		assert(
			!contradictory.success,
			"a drop-in with a startDate is rejected rather than stored half-bounded",
		);

		const enrolment = createClassBodySchema.safeParse({
			...baseClass,
			enrollmentOpensAt: ahead(1).toISOString(),
		});
		assert(
			!enrolment.success,
			"a defaulted drop-in with an enrolment window is rejected too",
		);
	}

	console.log("\n8. Ordering rules...");
	{
		const inverted = createClassBodySchema.safeParse({
			...baseClass,
			format: "batch",
			startDate: ahead(30).toISOString(),
			endDate: ahead(3).toISOString(),
		});
		assert(!inverted.success, "endDate before startDate is rejected");

		const invertedEnrolment = createClassBodySchema.safeParse({
			...baseClass,
			format: "batch",
			startDate: ahead(3).toISOString(),
			endDate: ahead(30).toISOString(),
			enrollmentOpensAt: ahead(5).toISOString(),
			enrollmentClosesAt: ahead(2).toISOString(),
		});
		assert(
			!invertedEnrolment.success,
			"enrollmentClosesAt before enrollmentOpensAt is rejected",
		);

		const afterRun = createClassBodySchema.safeParse({
			...baseClass,
			format: "batch",
			startDate: ahead(3).toISOString(),
			endDate: ahead(30).toISOString(),
			enrollmentClosesAt: ahead(40).toISOString(),
		});
		assert(
			!afterRun.success,
			"enrolment closing after the run ends is rejected as meaningless",
		);
	}

	console.log("\n9. imageUrl must be a URL or empty...");
	{
		assert(
			createClassBodySchema.safeParse({ ...baseClass, imageUrl: "" }).success,
			"empty is allowed — an image is optional",
		);
		assert(
			createClassBodySchema.safeParse({
				...baseClass,
				imageUrl: "https://cdn.fitflix.in/classes/strength.jpg",
			}).success,
			"a real URL is allowed",
		);
		assert(
			!createClassBodySchema.safeParse({ ...baseClass, imageUrl: "strength.jpg" })
				.success,
			"a bare filename is rejected — the app renders this directly",
		);
	}

	console.log("\n10. Partial updates are checked against the merged document...");
	{
		// Sending only `format: "batch"` looks fine in isolation. It is only
		// wrong once merged with a stored class that has no dates.
		const sentAlone = updateClassBodySchema.safeParse({ format: "batch" });
		assert(
			!sentAlone.success,
			"flipping to batch with no dates in the same payload is caught by the validator",
		);

		const storedDropIn = {
			format: "drop_in",
			startDate: null,
			endDate: null,
			enrollmentOpensAt: null,
			enrollmentClosesAt: null,
		};
		const merged = eventFieldsSchema.safeParse({
			...pickEventFields(storedDropIn),
			...pickEventFields({ format: "batch" }),
		});
		assert(
			!merged.success,
			"merging batch onto a stored drop-in with no dates is rejected",
		);

		const storedBatch = {
			format: "batch",
			startDate: ahead(3),
			endDate: ahead(30),
			enrollmentOpensAt: now,
			enrollmentClosesAt: ahead(2),
		};
		const movedEnd = eventFieldsSchema.safeParse({
			...pickEventFields(storedBatch),
			...pickEventFields({ endDate: ago(1) }),
		});
		assert(
			!movedEnd.success,
			"pulling endDate back before startDate is caught only by the merge check",
		);

		const validMove = eventFieldsSchema.safeParse({
			...pickEventFields(storedBatch),
			...pickEventFields({ endDate: ahead(60) }),
		});
		assert(validMove.success, "extending a run is allowed");
	}

	console.log("\n11. pickEventFields drops absent keys, keeps explicit nulls...");
	{
		const picked = pickEventFields({
			format: "batch",
			startDate: undefined,
			endDate: null,
			name: "ignored",
		});
		assert(
			!("startDate" in picked),
			"an undefined key is dropped so a merge cannot blank a stored value",
		);
		assert(
			"endDate" in picked && picked.endDate === null,
			"an explicit null is kept — clearing a date is a real intent",
		);
		assert(!("name" in picked), "non-event fields are not picked up");
		assert(
			Object.keys(pickEventFields(null)).length === 0,
			"a null source yields an empty object rather than throwing",
		);
	}

	console.log("\n🎉 Class Events (C1) Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Class events unit test failed:", err);
	process.exit(1);
}
