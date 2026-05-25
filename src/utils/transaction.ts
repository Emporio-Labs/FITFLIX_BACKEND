import mongoose from "mongoose";

/**
 * Runs `fn` inside a MongoDB transaction when the connection supports it
 * (i.e. Atlas / replica set). Falls back to running `fn` without a session
 * on standalone mongod (local dev), catching the "Transaction numbers are
 * only allowed on a replica set" error specifically.
 */
export async function withOptionalTransaction<T>(
	fn: (session: mongoose.ClientSession | undefined) => Promise<T>,
): Promise<T> {
	let session: mongoose.ClientSession | undefined;

	try {
		session = await mongoose.startSession();
	} catch {
		// Cannot start session — fall back to no-transaction mode
		return fn(undefined);
	}

	try {
		let result: T;

		await session.withTransaction(async () => {
			result = await fn(session);
		});

		return result!;
	} catch (err) {
		// Standalone mongod: "Transaction numbers are only allowed on a replica set member"
		const msg = err instanceof Error ? err.message : String(err);
		if (
			msg.includes("Transaction numbers are only allowed") ||
			msg.includes("replica set") ||
			msg.includes("not a replica set")
		) {
			return fn(undefined);
		}
		throw err;
	} finally {
		await session.endSession();
	}
}
