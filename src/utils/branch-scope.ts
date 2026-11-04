import type { Request } from "express";
import mongoose from "mongoose";
import Trainer from "../models/Trainer";
import User from "../models/User";
import { normalizeRole } from "../middleware/rbac.middleware";
import { LocationError } from "./location.resolver";

/**
 * Which branch a staff-console read is limited to.
 *
 * - admin: the branch they picked — `?locationId=` first, then the console's
 *   `X-Location-Id` header — or null for "all branches".
 * - member: whatever `?locationId=` they sent, unchanged; member reads keep
 *   their own home-club rules.
 * - trainer and every other staff role: always their own branch. What they
 *   send is ignored, so a trainer can't read another branch by editing the
 *   request. With no branch on their record they are left unscoped, as before.
 *
 * Throws LocationError for a malformed id, which list handlers already map
 * to a 400.
 */
export const resolveBranchScope = async (
	req: Request,
): Promise<string | null> => {
	const role = req.user ? normalizeRole(req.user.role) : null;

	if (role === "admin" || role === "user" || !req.user) {
		const fromQuery =
			typeof req.query.locationId === "string" ? req.query.locationId.trim() : "";
		const fromHeader =
			role === "admin" ? String(req.get("x-location-id") ?? "").trim() : "";
		const picked = fromQuery || fromHeader;
		if (!picked || picked === "all") return null;
		if (!mongoose.Types.ObjectId.isValid(picked)) {
			throw new LocationError(
				"INVALID_LOCATION_ID",
				`"${picked}" is not a valid location id`,
			);
		}
		return picked;
	}

	return ownBranchId(req.user.id, role);
};

/** A staff login's own branch: Trainer.locationId, else User.homeLocationId. */
const ownBranchId = async (
	id: string,
	role: string | null,
): Promise<string | null> => {
	if (!mongoose.Types.ObjectId.isValid(id)) return null;
	if (role === "trainer") {
		const trainer = await Trainer.findById(id).select("locationId").lean();
		return trainer?.locationId ? String(trainer.locationId) : null;
	}
	const user = await User.findById(id).select("homeLocationId").lean();
	return user?.homeLocationId ? String(user.homeLocationId) : null;
};

/** `{ [field]: ObjectId }` for the request's branch, or `{}` when unscoped. */
export const branchFilter = async (
	req: Request,
	field = "locationId",
): Promise<Record<string, unknown>> => {
	const id = await resolveBranchScope(req);
	return id ? { [field]: new mongoose.Types.ObjectId(id) } : {};
};
