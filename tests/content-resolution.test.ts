/**
 * Pure-function coverage for the content override read path
 * (utils/content-resolution.ts). No server, no database — mirrors
 * promotion-visibility.test.ts, and for the same reason: the filter and the
 * precedence rule are plain data transforms, so these run in milliseconds and
 * cannot be flaky.
 *
 * The filter assertions interpret the produced query against sample documents
 * rather than checking its shape, because a structurally tidy filter can still
 * be semantically wrong — and this filter decides what copy a given platform
 * is allowed to be served.
 */
import {
	buildContentFilter,
	type ContentRow,
	isContentPlatform,
	resolveContentMap,
} from "../src/utils/content-resolution";
import {
	createContentOverrideSchema,
	updateContentOverrideSchema,
} from "../src/validators/content.validator";
import { assert } from "./test-helpers";

type SampleDoc = {
	label: string;
	isActive: boolean;
	platform: "ios" | "android" | null;
};

/**
 * A deliberately small interpreter for the subset of Mongo operators this
 * filter emits. If buildContentFilter ever grows an operator, this throws
 * rather than silently passing a document it does not understand.
 */
const matches = (doc: SampleDoc, filter: Record<string, unknown>): boolean =>
	Object.entries(filter).every(([field, condition]) => {
		const actual = (doc as unknown as Record<string, unknown>)[field];
		if (
			condition !== null &&
			typeof condition === "object" &&
			!Array.isArray(condition)
		) {
			const ops = Object.entries(condition as Record<string, unknown>);
			return ops.every(([op, operand]) => {
				if (op === "$in") return (operand as unknown[]).includes(actual);
				throw new Error(`Unhandled operator in content filter: ${op}`);
			});
		}
		return actual === condition;
	});

const docs: SampleDoc[] = [
	{ label: "general live", isActive: true, platform: null },
	{ label: "ios live", isActive: true, platform: "ios" },
	{ label: "android live", isActive: true, platform: "android" },
	{ label: "general inactive", isActive: false, platform: null },
	{ label: "ios inactive", isActive: false, platform: "ios" },
];

const visible = (filter: Record<string, unknown>): string[] =>
	docs.filter((d) => matches(d, filter)).map((d) => d.label);

function runUnitTests() {
	console.log("\n🔎 Content filter — who sees which rows");
	{
		const anonymous = visible(buildContentFilter({}));
		assert(
			anonymous.includes("general live"),
			"a caller with no platform sees general rows",
		);
		assert(
			!anonymous.includes("ios live") && !anonymous.includes("android live"),
			"a caller with no platform is never served platform-specific copy",
		);
		assert(
			!anonymous.includes("general inactive"),
			"inactive rows are never served, platform aside",
		);

		const ios = visible(buildContentFilter({ platform: "ios" }));
		assert(
			ios.includes("general live") && ios.includes("ios live"),
			"an iOS caller sees general rows plus its own",
		);
		assert(
			!ios.includes("android live"),
			"an iOS caller never sees Android copy",
		);
		assert(
			!ios.includes("ios inactive"),
			"an inactive iOS row stays hidden from iOS",
		);

		assert(
			!visible(buildContentFilter({ platform: null })).includes("ios live"),
			"an explicit null platform behaves like no platform",
		);
	}

	console.log("\n🔎 Precedence — platform-specific wins over general");
	{
		const general: ContentRow = {
			key: "visitor.hero.title",
			value: "general",
			platform: null,
		};
		const ios: ContentRow = {
			key: "visitor.hero.title",
			value: "ios",
			platform: "ios",
		};

		assert(
			resolveContentMap([general, ios])["visitor.hero.title"] === "ios",
			"the platform row overrides the general row",
		);
		assert(
			resolveContentMap([ios, general])["visitor.hero.title"] === "ios",
			"precedence does not depend on the order Mongo returns rows in",
		);
		assert(
			resolveContentMap([general])["visitor.hero.title"] === "general",
			"the general row is used when no platform row exists",
		);
		assert(
			Object.keys(resolveContentMap([])).length === 0,
			"no rows resolves to an empty map, not an error",
		);
		assert(
			resolveContentMap([{ key: "a.b", value: "", platform: null }])["a.b"] ===
				"",
			"an empty override is preserved — blanking a line is a real edit",
		);
		assert(
			resolveContentMap([{ key: "a.b", value: "general" }])["a.b"] === "general",
			"a row with no platform field at all counts as the general row",
		);
		assert(
			resolveContentMap([
				{ key: "a.b", value: "general" },
				{ key: "a.b", value: "ios", platform: "ios" },
			])["a.b"] === "ios",
			"the platform row still wins over a row whose platform is absent",
		);
	}

	console.log("\n🔎 Key and payload validation");
	{
		const ok = (key: string) =>
			createContentOverrideSchema.safeParse({ key, value: "x" }).success;

		assert(ok("visitor.hero.title"), "a dotted lowercase key is accepted");
		assert(ok("landing_cta.primary-label"), "underscores and hyphens are allowed");
		assert(!ok("Visitor.Hero"), "an uppercase key is rejected");
		assert(!ok("visitor hero"), "a key with a space is rejected");
		assert(!ok("visitor..hero"), "an empty key segment is rejected");
		assert(!ok(".visitor"), "a leading separator is rejected");
		assert(!ok("visitor."), "a trailing separator is rejected");

		assert(
			createContentOverrideSchema.safeParse({ key: "a.b", value: "" }).success,
			"an empty value is accepted",
		);
		assert(
			!createContentOverrideSchema.safeParse({
				key: "a.b",
				value: "x".repeat(2001),
			}).success,
			"an oversized value is rejected",
		);
		assert(
			createContentOverrideSchema.safeParse({
				key: "a.b",
				value: "x",
				platform: null,
			}).success,
			"an explicit null platform is accepted",
		);
		assert(
			!createContentOverrideSchema.safeParse({
				key: "a.b",
				value: "x",
				platform: "web",
			}).success,
			"an unknown platform is rejected",
		);

		assert(
			!updateContentOverrideSchema.safeParse({}).success,
			"an empty update is rejected rather than silently doing nothing",
		);
		assert(
			updateContentOverrideSchema.safeParse({ value: "just the text" }).success,
			"a partial update of one field is accepted",
		);

		assert(
			isContentPlatform("ios") && !isContentPlatform("web"),
			"the platform guard accepts only known platforms",
		);
	}

	console.log("\n🎉 Content Resolution Unit Tests Passed!");
}

try {
	runUnitTests();
	process.exit(0);
} catch (err) {
	console.error("Content resolution unit test failed:", err);
	process.exit(1);
}
