import type mongoose from "mongoose";
import { getIO } from "./realtime.service";

let salesStaffOnDutyOverride:
	| ((branchId: string) => boolean | null | Promise<boolean | null>)
	| null = null;

/**
 * Test helper to override on-duty status in unit/integration tests.
 */
export function setSalesStaffOnDutyOverride(
	override:
		| ((branchId: string) => boolean | null | Promise<boolean | null>)
		| null,
): void {
	salesStaffOnDutyOverride = override;
}

/**
 * FX-42.3: Check if any sales person / frontdesk staff is on duty at the branch.
 * If no sales staff is active/connected at the branch, returns false.
 */
export async function isSalesStaffOnDuty(
	branchId?: string | mongoose.Types.ObjectId | null,
): Promise<boolean> {
	const resolvedBranchId = branchId ? branchId.toString() : "";

	if (salesStaffOnDutyOverride) {
		const result = await salesStaffOnDutyOverride(resolvedBranchId);
		if (result !== null) return result;
	}

	const io = getIO();
	if (!io) return false;

	// Check branch room sockets
	if (resolvedBranchId) {
		const branchRoom = io.sockets.adapter.rooms.get(`branch:${resolvedBranchId}`);
		if (branchRoom && branchRoom.size > 0) {
			for (const socketId of branchRoom) {
				const socket = io.sockets.sockets.get(socketId);
				if (!socket) continue;
				const user = socket.data?.user as { id?: string; role?: string } | undefined;
				const role = user?.role;
				if (
					role === "frontdesk" ||
					role === "staff" ||
					role === "ROLE_FRONT_END_STAFF"
				) {
					return true;
				}
			}
		}
	}

	// Check global frontdesk room sockets for branch match or general frontdesk presence
	const frontdeskRoom = io.sockets.adapter.rooms.get("frontdesk");
	if (frontdeskRoom && frontdeskRoom.size > 0) {
		for (const socketId of frontdeskRoom) {
			const socket = io.sockets.sockets.get(socketId);
			if (!socket) continue;
			const user = socket.data?.user as
				| { id?: string; role?: string; branchId?: string }
				| undefined;
			const socketBranch =
				socket.handshake.auth?.branchId ||
				socket.handshake.query?.branchId ||
				user?.branchId;

			// If socket belongs to this branch, or if branch is not specified
			if (
				!resolvedBranchId ||
				(socketBranch && String(socketBranch) === resolvedBranchId)
			) {
				const role = user?.role;
				if (
					role === "frontdesk" ||
					role === "staff" ||
					role === "ROLE_FRONT_END_STAFF"
				) {
					return true;
				}
			}
		}
	}

	return false;
}
