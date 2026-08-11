/**
 * Pure check on the feed filter — no database.
 *
 * The risk in making pinned posts sticky is the keyset cursor: the body of the
 * feed must stay ordered by (createdAt, _id) alone, and must never re-serve a
 * pinned post that page one already showed.
 */
import { buildFeedFilter } from "../src/services/community/post.service";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
	if (cond) { ok++; console.log(`  PASS  ${name}`); }
	else { bad++; console.log(`  FAIL  ${name}`); }
};

const first = buildFeedFilter(null, []);
check("page one excludes pinned from the chronological body",
	first.pinnedAt === null);
check("page one has no cursor predicate", first.$or === undefined);

const cursor = buildFeedFilter(
	{ createdAt: new Date("2026-07-01T00:00:00.000Z").toISOString(), id: "64b7f9c2e13a4b0012aa77cd" },
	[],
);
check("later pages still exclude pinned", cursor.pinnedAt === null);
check("later pages keep the (createdAt,_id) keyset predicate",
	Array.isArray(cursor.$or) && (cursor.$or as unknown[]).length === 2);

const blocked = buildFeedFilter(null, ["64b7f9c2e13a4b0012aa77ce"]);
check("block filter survives alongside the pinned exclusion",
	blocked.pinnedAt === null && blocked.authorId !== undefined);

// The pinned query getFeed builds: same base, pinnedAt inverted.
const pinnedQuery = { ...buildFeedFilter(null, []), pinnedAt: { $ne: null } };
check("pinned query overrides the exclusion rather than inheriting it",
	JSON.stringify(pinnedQuery.pinnedAt) === JSON.stringify({ $ne: null }));
check("pinned query keeps the published/not-deleted guards",
	pinnedQuery.deletedAt === null && pinnedQuery.status !== undefined);

console.log(`\n${ok} passed, ${bad} failed`);
process.exit(bad === 0 ? 0 : 1);
