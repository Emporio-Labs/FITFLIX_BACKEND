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
	} catch (err: any) {
		// Standalone mongod: "Transaction numbers are only allowed on a replica set member"
		// If retryWrites=true (default), the driver wraps this in a retryable writes error.
		const isTxError =
			err?.message?.includes("Transaction numbers are only allowed") ||
			err?.message?.includes("does not support retryable writes") ||
			err?.originalError?.message?.includes("Transaction numbers are only allowed") ||
			err?.code === 20;

		if (isTxError) {
			// Run without transaction wrapper
			return fn(undefined);
		}
		throw err;
	} finally {
		await session.endSession();
	}
}
