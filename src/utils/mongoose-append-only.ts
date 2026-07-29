import type mongoose from "mongoose";

export const APPEND_ONLY_ERROR =
	"append-only: updates and deletes are not allowed on this collection";

/**
 * Applies middleware to a Mongoose schema that prevents any update or delete
 * operations from running — making the collection effectively append-only at
 * the application layer. Use on audit / version-history collections where
 * immutability matters.
 */
export function applyAppendOnlyGuard(
	schema: mongoose.Schema,
	collectionName: string,
): void {
	const guard = function (this: unknown, next: (err?: Error) => void) {
		next(new Error(`[${collectionName}] ${APPEND_ONLY_ERROR}`));
	};

	schema.pre("updateOne", guard);
	schema.pre("updateMany", guard);
	schema.pre("findOneAndUpdate", guard);
	schema.pre("findOneAndDelete", guard);
	schema.pre("deleteOne", guard);
	schema.pre("deleteMany", guard);
}
