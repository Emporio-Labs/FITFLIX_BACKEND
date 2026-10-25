import type { Request } from "express";
import type mongoose from "mongoose";
import LoginEvent from "../models/LoginEvent";
import { resolveLocationId } from "./location.resolver";

type LoginAccountKind = "user" | "admin" | "trainer";

type LoginAccountDoc = {
	_id: { toString(): string };
	adminName?: string;
	trainerName?: string;
	username?: string;
	locationId?: mongoose.Types.ObjectId | null;
	homeLocationId?: mongoose.Types.ObjectId | null;
};

/**
 * Trainers carry a branch, members a home club; admins have neither. While a
 * single branch is active the resolver falls back to it, so single-branch
 * deployments still get a branch on every row. Ambiguous → null, never throw.
 */
const resolveLoginBranch = async (
	account: LoginAccountDoc,
): Promise<mongoose.Types.ObjectId | null> => {
	const own = account.locationId ?? account.homeLocationId ?? null;
	if (own) return own;
	try {
		return await resolveLocationId();
	} catch {
		return null;
	}
};

/**
 * Persist a successful login. Best-effort by design: an audit-write failure
 * must never fail or slow the login itself, so callers don't await this.
 */
export const recordLoginEvent = async ({
	req,
	kind,
	account,
	role,
	email,
}: {
	req: Request;
	kind: LoginAccountKind;
	account: LoginAccountDoc;
	role: string;
	email: string;
}): Promise<void> => {
	try {
		await LoginEvent.create({
			accountId: account._id,
			accountKind: kind,
			role,
			name: account.adminName ?? account.trainerName ?? account.username ?? "",
			email,
			locationId: await resolveLoginBranch(account),
			ip: req.ip ?? "",
			userAgent: (req.header("user-agent") ?? "").slice(0, 300),
		});
	} catch (error) {
		console.error("[AUTH][LOGIN] Failed to record login event", error);
	}
};
