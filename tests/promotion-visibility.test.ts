/**
 * Pure-function coverage for the promotions visibility split
 * (utils/promotion-visibility.ts). No server, no database — the filter is a
 * plain query object, so these run in milliseconds and can't be flaky.
 *
 * The assertions interpret the produced filter against sample documents rather
 * than checking its shape. Shape assertions would pass on a filter that is
 * structurally tidy and semantically wrong, which is the failure that matters
 * here: this filter is the whole security surface of the promotions API.
 */
import mongoose from "mongoose";
import {
	buildPromotionFilter,
	canSeeHiddenPromotions,
	PROMOTION_SORT,
} from "../src/utils/promotion-visibility";
import { assert } from "./test-helpers";

type SampleDoc = {
	label: string;
	isActive: boolean;
	activeFrom: Date;
	activeTo: Date;
	locationId: mongoose.Types.ObjectId | null;
};

/**
 * A deliberately small interpreter for the subset of Mongo operators this
 * filter emits. If buildPromotionFilter ever grows an operator, this throws
 * rather than silently passing the document through.
 */
const matches = (filter: Record<string, unknown>, doc: SampleDoc): boolean => {
	for (const [field, condition] of Object.entries(filter)) {
		const value = (doc as Record<string, unknown>)[field];

		if (condition === null || typeof condition !== "object") {
			if (value !== condition) return false;
			continue;
		}

		for (const [op, operand] of Object.entries(
			condition as Record<string, unknown>,
		)) {
			switch (op) {
				case "$lte":
					if (!((value as Date) <= (operand as Date))) return false;
					break;
				case "$gte":
					if (!((value as Date) >= (operand as Date))) return false;
					break;
				case "$in": {
					const wanted = (operand as unknown[]).map((v) =>
						v === null ? null : String(v),
					);
					if (!wanted.includes(value === null ? null : String(value)))
						return false;
					break;
				}
				default:
					throw new Error(`Unhandled operator ${op} on field ${field}`);
			}
		}
	}
	return true;
};

const visible = (filter: Record<string, unknown>, docs: SampleDoc[]): string[] =>
	docs.filter((d) => matches(filter, d)).map((d) => d.label);

function runUnitTests() {
	console.log("=== Unit Test: Promotion Visibility (promotion-visibility.ts) ===");

	const now = new Date("2026-08-16T12:00:00.000Z");
	const branchA = new mongoose.Types.ObjectId();
	const branchB = new mongoose.Types.ObjectId();

	const day = 24 * 60 * 60 * 1000;
	const docs: SampleDoc[] = [
		{
			label: "live",
			isActive: true,
			activeFrom: new Date(now.getTime() - day),
			activeTo: new Date(now.getTime() + day),
			locationId: null,
		},
		{
			label: "switched-off",
			isActive: false,
			activeFrom: new Date(now.getTime() - day),
			activeTo: new Date(now.getTime() + day),
			locationId: null,
		},
		{
			label: "not-started",
			isActive: true,
			activeFrom: new Date(now.getTime() + day),
			activeTo: new Date(now.getTime() + 2 * day),
			locationId: null,
		},
		{
			label: "expired",
			isActive: true,
			activeFrom: new Date(now.getTime() - 2 * day),
			activeTo: new Date(now.getTime() - day),
			locationId: null,
		},
		{
			label: "starts-exactly-now",
			isActive: true,
			activeFrom: new Date(now.getTime()),
			activeTo: new Date(now.getTime() + day),
			locationId: null,
		},
		{
			label: "ends-exactly-now",
			isActive: true,
			activeFrom: new Date(now.getTime() - day),
			activeTo: new Date(now.getTime()),
			locationId: null,
		},
		{
			label: "branch-a",
			isActive: true,
			activeFrom: new Date(now.getTime() - day),
			activeTo: new Date(now.getTime() + day),
			locationId: branchA,
		},
		{
			label: "branch-b",
			isActive: true,
			activeFrom: new Date(now.getTime() - day),
			activeTo: new Date(now.getTime() + day),
			locationId: branchB,
		},
	];

	console.log("\n1. Active-window filtering — the anonymous/public path...");
	{
		const shown = visible(buildPromotionFilter({ now }), docs);

		assert(shown.includes("live"), "a live, in-window promotion is shown");
		assert(
			!shown.includes("switched-off"),
			"isActive: false is hidden even though its window is open",
		);
		assert(
			!shown.includes("not-started"),
			"a promotion whose activeFrom is in the future is hidden",
		);
		assert(!shown.includes("expired"), "a promotion past activeTo is hidden");

		// Inclusive bounds. A promo scheduled to start on the hour should be live
		// on the hour, not one tick later.
		assert(
			shown.includes("starts-exactly-now"),
			"activeFrom exactly equal to now is live (bound is inclusive)",
		);
		assert(
			shown.includes("ends-exactly-now"),
			"activeTo exactly equal to now is live (bound is inclusive)",
		);
	}

	console.log("\n2. Members cannot escalate into the hidden set...");
	{
		// The query param is attacker-controlled; only the role decides.
		const shown = visible(
			buildPromotionFilter({ role: "user", now, includeInactive: true }),
			docs,
		);

		assert(
			!shown.includes("switched-off"),
			"a member passing includeInactive=true still cannot see a disabled promotion",
		);
		assert(
			!shown.includes("expired") && !shown.includes("not-started"),
			"a member passing includeInactive=true is still window-bound",
		);
		assert(shown.includes("live"), "the member still sees the live set");
	}

	console.log("\n3. Staff may ask for the full list...");
	{
		for (const role of ["admin", "frontdesk"] as const) {
			const shown = visible(
				buildPromotionFilter({ role, now, includeInactive: true }),
				docs,
			);
			assert(
				shown.length === docs.length,
				`${role} with includeInactive=true sees every promotion`,
			);
		}

		// Roles arrive raw off the token — authenticateToken does not normalise
		// them. Comparing the raw string would deny these two silently.
		for (const role of ["staff", "ROLE_FRONT_DESK_STAFF"] as const) {
			const shown = visible(
				buildPromotionFilter({ role, now, includeInactive: true }),
				docs,
			);
			assert(
				shown.length === docs.length,
				`raw role "${role}" normalises to staff and sees every promotion`,
			);
		}
	}

	console.log("\n4. includeInactive is opt-in, not implied by being staff...");
	{
		const shown = visible(buildPromotionFilter({ role: "admin", now }), docs);
		assert(
			!shown.includes("switched-off") && !shown.includes("expired"),
			"an admin who does not ask for the full list gets the live set",
		);
	}

	console.log("\n5. canSeeHiddenPromotions — who counts as staff...");
	{
		assert(canSeeHiddenPromotions("admin"), "admin can see hidden promotions");
		assert(
			canSeeHiddenPromotions("frontdesk"),
			"frontdesk can see hidden promotions",
		);
		assert(canSeeHiddenPromotions("staff"), 'raw "staff" normalises to frontdesk');
		assert(
			canSeeHiddenPromotions("ROLE_FRONT_DESK_STAFF"),
			'raw "ROLE_FRONT_DESK_STAFF" normalises to admin',
		);
		assert(!canSeeHiddenPromotions("user"), "a member cannot");
		assert(!canSeeHiddenPromotions("trainer"), "a trainer cannot");
		assert(!canSeeHiddenPromotions("nutritionist"), "a nutritionist cannot");
		assert(!canSeeHiddenPromotions(null), "an anonymous caller cannot");
		assert(!canSeeHiddenPromotions(undefined), "a missing role cannot");
	}

	console.log("\n6. Location scoping — company-wide rides along with a branch...");
	{
		const shown = visible(
			buildPromotionFilter({ now, locationId: branchA.toString() }),
			docs,
		);

		assert(shown.includes("branch-a"), "branch A sees its own promotion");
		assert(
			shown.includes("live"),
			"a company-wide promotion (locationId: null) is not shadowed by a branch scope",
		);
		assert(
			!shown.includes("branch-b"),
			"branch A never sees another branch's promotion",
		);
	}

	console.log("\n7. No location scope means no location constraint...");
	{
		const shown = visible(buildPromotionFilter({ now }), docs);
		assert(
			shown.includes("branch-a") && shown.includes("branch-b"),
			"an unscoped list spans every branch — what the admin list wants",
		);
	}

	console.log("\n8. The two constraints compose...");
	{
		const shown = visible(
			buildPromotionFilter({
				role: "admin",
				now,
				locationId: branchA.toString(),
				includeInactive: true,
			}),
			docs,
		);

		assert(
			shown.includes("switched-off"),
			"the window is dropped for staff asking for the full list",
		);
		assert(
			!shown.includes("branch-b"),
			"dropping the window does not drop the location scope",
		);
	}

	console.log("\n9. Ordering...");
	{
		assert(
			PROMOTION_SORT.priority === -1,
			"higher priority sorts first",
		);
		assert(
			PROMOTION_SORT.activeFrom === -1,
			"ties break on the most recently started promotion",
		);
	}

	console.log("\n🎉 Promotion Visibility Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Promotion visibility unit test failed:", err);
	process.exit(1);
}
