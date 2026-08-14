import mongoose from "mongoose";

/**
 * Executes an operation inside a MongoDB transaction on replica sets.
 *
 * CRITICAL SAFETY GUARD:
 * On standalone single-node MongoDB instances (e.g. local unit tests / dev),
 * transactions are not supported by the storage engine, so this falls back
 * to executing sequentially with `session = null`.
 *
 * Outside of development or test environments (`NODE_ENV === "production"` / staging),
 * if a standalone non-replica topology is detected, this logs a high-severity CRITICAL ERROR
 * and throws to prevent silent loss of ACID guarantees.
 */
export async function executeInTransaction<T>(
	operation: (session: mongoose.ClientSession | null) => Promise<T>,
): Promise<T> {
	const topologyType =
		mongoose.connection.client?.topology?.description?.type;
	const isReplicaSet =
		topologyType === "ReplicaSetWithPrimary" ||
		topologyType === "Sharded" ||
		(topologyType !== "Single" && topologyType !== undefined);

	const isDevOrTest =
		process.env.NODE_ENV === "development" ||
		process.env.NODE_ENV === "test" ||
		!process.env.NODE_ENV;

	if (!isReplicaSet) {
		if (!isDevOrTest) {
			const errorMsg = `[CRITICAL_SECURITY_ALERT] MongoDB topology is "${topologyType || "Unknown"}" (non-replica set) in NODE_ENV="${process.env.NODE_ENV}". Multi-document transactions are DISABLED. Refusing to execute financial/quota mutation without ACID guarantees.`;
			console.error(errorMsg);
			throw new Error(errorMsg);
		}

		console.warn(
			`[TRANSACTION_DEV_NOTICE] Executing operation without MongoDB transaction session (Local Single-Node topology: ${topologyType || "Single"}).`,
		);
		return operation(null);
	}

	const session = await mongoose.startSession();
	try {
		let result: T;
		await session.withTransaction(async () => {
			result = await operation(session);
		});
		return result!;
	} catch (error) {
		console.error("[TRANSACTION_ROLLBACK]", error);
		throw error;
	} finally {
		await session.endSession();
	}
}
