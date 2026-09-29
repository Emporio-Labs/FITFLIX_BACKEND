import mongoose from "mongoose";
import { LocationError, resolveLocationId } from "./location.resolver";

/**
 * FX-01: every new class, slot, trainer, membership, booking, invoice, credit
 * entry, lead and member is saved with its branch.
 *
 * A plugin rather than an edit at each of the ~30 places those records are
 * created, so a create path added later is covered too. On a new document
 * whose branch field is empty it fills the branch in, in this order:
 *
 *   1. what the caller passed (left untouched)
 *   2. the model's own rule — a booking takes the branch of what it books,
 *      a membership / invoice / credit entry the member's home branch
 *   3. the default branch — the one active branch, while there is only one
 *
 * It never blocks a save. If nothing resolves (no branch seeded, or several
 * active and the caller didn't say which) the record is saved exactly as it
 * would have been before FX-01, and a warning is logged;
 * scripts/check-missing-branch.ts counts any such records.
 *
 * Runs on `validate`, which Model.create, doc.save and Model.insertMany all
 * trigger. Upserts (findOneAndUpdate / updateOne with upsert) do not run it;
 * those callers set the branch themselves via $setOnInsert.
 */

type Id = mongoose.Types.ObjectId;
export type DeriveLocation = (doc: {
	get(path: string): unknown;
}) => Promise<Id | null | undefined>;

// resolveLocationId queries Location on every call; an insertMany of credit
// entries would ask the same question once per row. The answer only changes
// when a branch is opened or closed.
const DEFAULT_TTL_MS = 60_000;
let defaultCache: { id: Id | null; at: number } | null = null;

export const clearDefaultLocationCache = (): void => {
	defaultCache = null;
};

/**
 * The default branch — the one active branch — or null when there is none or
 * more than one. Cached for a minute. For callers that write with an upsert,
 * which bypasses the plugin.
 */
export const defaultLocationId = async (): Promise<Id | null> => {
	if (defaultCache && Date.now() - defaultCache.at < DEFAULT_TTL_MS) {
		return defaultCache.id;
	}
	let id: Id | null = null;
	try {
		id = await resolveLocationId();
	} catch (err) {
		// No branch, or more than one: there is no default to fall back on.
		if (!(err instanceof LocationError)) throw err;
	}
	defaultCache = { id, at: Date.now() };
	return id;
};

/** A referenced document's branch field, or null. Never throws. */
export const branchOf = async (
	modelName: string,
	id: unknown,
	field = "locationId",
): Promise<Id | null> => {
	if (!id) return null;
	try {
		const doc = await mongoose
			.model(modelName)
			.findById(id)
			.select(field)
			.lean<Record<string, unknown>>();
		const value = doc?.[field];
		return value ? (value as Id) : null;
	} catch {
		return null;
	}
};

/** The member's home branch. */
export const homeBranchOf = (userId: unknown) =>
	branchOf("User", userId, "homeLocationId");

export function locationStampPlugin(
	schema: mongoose.Schema,
	options: { model: string; field?: string; derive?: DeriveLocation },
): void {
	const field = options.field ?? "locationId";

	schema.pre("validate", async function () {
		if (!this.isNew || this.get(field)) return;
		try {
			const id =
				(options.derive ? await options.derive(this) : null) ??
				(await defaultLocationId());
			if (id) {
				this.set(field, id);
				return;
			}
			console.warn(
				`[location-stamp] ${options.model} ${String(this._id)} saved without a branch: no default branch to use`,
			);
		} catch (err) {
			console.warn(
				`[location-stamp] ${options.model} ${String(this._id)} saved without a branch:`,
				(err as Error).message,
			);
		}
	});
}
