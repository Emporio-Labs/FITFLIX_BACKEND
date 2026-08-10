import type { Schema } from "mongoose";

/**
 * Marker used at the start of every append-only violation message so callers
 * (and tests) can reliably distinguish an append-only rejection from any other
 * error.
 */
export const APPEND_ONLY_ERROR = "APPEND_ONLY_VIOLATION";

export class AppendOnlyViolationError extends Error {
	constructor(collectionLabel: string, operation: string) {
		super(
			`${APPEND_ONLY_ERROR}: ${collectionLabel} is append-only; ` +
				`${operation} is not permitted.`,
		);
		this.name = "AppendOnlyViolationError";
	}
}

// Query-level write operations that must be rejected. These fire for both
// `Model.updateOne(...)` and `SomeQuery.updateOne()` forms.
const BLOCKED_QUERY_HOOKS = [
	"updateOne",
	"updateMany",
	"replaceOne",
	"findOneAndUpdate",
	"findOneAndReplace",
	"deleteOne",
	"deleteMany",
	"findOneAndDelete",
] as const;

/**
 * Enforce append-only semantics on a schema at the data-access layer: any
 * attempt to UPDATE or DELETE an existing document — via a Model/Query helper
 * OR via `document.save()` on an already-persisted document OR
 * `document.deleteOne()` — throws before the write reaches MongoDB.
 *
 * This covers 100% of the application's write paths (everything routes through
 * these Mongoose models). For defence-in-depth against a raw `mongosh` session
 * that bypasses Mongoose entirely, pair this with the per-collection restricted
 * database role emitted by `scripts/community-setup.ts` (find + insert only).
 *
 * INSERTs (`create`, `insertMany`, `new Model().save()`) are always allowed.
 */
export function applyAppendOnlyGuard(
	schema: Schema,
	collectionLabel: string,
): void {
	// Query middleware — Model.updateOne / Query.deleteOne / findOneAndUpdate …
	for (const hook of BLOCKED_QUERY_HOOKS) {
		schema.pre(hook, { query: true, document: false }, function () {
			throw new AppendOnlyViolationError(collectionLabel, hook);
		});
	}

	// Document middleware — doc.deleteOne() / doc.remove()
	schema.pre(
		"deleteOne",
		{ document: true, query: false },
		function () {
			throw new AppendOnlyViolationError(collectionLabel, "document.deleteOne");
		},
	);

	// Allow the very first save (insert) but reject any save that mutates an
	// already-persisted document.
	schema.pre("save", function (this: { isNew: boolean }) {
		if (!this.isNew) {
			throw new AppendOnlyViolationError(collectionLabel, "document.save/update");
		}
	});
}
