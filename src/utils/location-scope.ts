import type { Request, Response } from "express";
import mongoose from "mongoose";
import User from "../models/User";
import {
	LocationError,
	assertAdminCanAccessLocation,
	buildScopedLocationFilter,
	getAdminLocationScope,
	mapLocationError,
	resolveLocationId,
} from "./location.resolver";

/**
 * Request-level glue over location.resolver.
 *
 * Every branch-scoped endpoint needs the same three things: pull `locationId`
 * off the request, intersect it with the caller's own branch scope, and turn a
 * LocationError into an HTTP response. Keeping that here stops each controller
 * from re-deriving it and drifting.
 */

/** `?locationId=` (or a body `locationId`) narrowed to a usable string. */
export const readLocationParam = (
	value: unknown,
): string | undefined => (typeof value === "string" && value ? value : undefined);

/**
 * Mongo filter fragment scoping a list query to the caller's branches.
 *
 * Pass `includeNull` for catalog collections where `locationId: null` means
 * "available at every branch" — those rows must survive a branch filter, and
 * it is also what keeps pre-backfill documents visible.
 */
export const scopedLocationFilter = (
	req: Request,
	options: { includeNull?: boolean; field?: string } = {},
): Record<string, unknown> =>
	buildScopedLocationFilter(
		req.user,
		readLocationParam(req.query.locationId) ?? null,
		options,
	);

/**
 * Resolve the branch for a write, honouring the caller's scope.
 *
 * `fallback` is the parent record's branch (a slot's, a class's, a member's
 * home club) — passing it means the client never has to send a locationId for
 * a record that already knows where it belongs.
 */
export const resolveWriteLocation = async (
	req: Request,
	fallback?: mongoose.Types.ObjectId | string | null,
): Promise<mongoose.Types.ObjectId> => {
	const explicit =
		readLocationParam(req.body?.locationId) ??
		readLocationParam(req.query.locationId);

	const locationId = await resolveLocationId(explicit ?? fallback ?? null);
	assertAdminCanAccessLocation(req.user, locationId);
	return locationId;
};

/**
 * Branch for a *catalog* write (service, therapy, plan, nutrition template).
 *
 * Unlike [resolveWriteLocation] this does not auto-resolve: a catalog row with
 * no locationId is deliberately company-wide, available at every branch. Only
 * an explicit value narrows it — except for a branch-scoped admin, who cannot
 * author company-wide rows and is defaulted to their own branch.
 */
export const resolveCatalogLocation = async (
	req: Request,
): Promise<mongoose.Types.ObjectId | null> => {
	const explicit = readLocationParam(req.body?.locationId);
	const scope = getAdminLocationScope(req.user);

	if (!explicit) {
		if (scope === null) {
			return null;
		}
		const sole = scope.length === 1 ? scope[0] : undefined;
		if (!sole) {
			throw new LocationError(
				"LOCATION_REQUIRED",
				"locationId is required — your account manages more than one branch",
			);
		}
		return sole;
	}

	const locationId = await resolveLocationId(explicit);
	assertAdminCanAccessLocation(req.user, locationId);
	return locationId;
};

/**
 * The branch a member's own records belong to (membership, invoice, credit).
 *
 * FX-01 requires per-member records to inherit the member's home branch, not
 * the plan's or the caller's. Returns null when the member has no home branch
 * yet — a pre-backfill state; a null stamp is valid and gets reattributed by
 * the ops backfill later.
 */
export const resolveMemberHomeLocation = async (
	userId: string | mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId | null> => {
	if (!mongoose.Types.ObjectId.isValid(userId as string)) {
		return null;
	}
	const user = await User.findById(userId).select("homeLocationId").lean();
	const raw = (user as { homeLocationId?: unknown } | null)?.homeLocationId;
	return raw instanceof mongoose.Types.ObjectId ? raw : null;
};

/**
 * Turn a LocationError into its HTTP response. Returns false for anything
 * else so the caller can fall through to `next(error)`.
 */
export const respondToLocationError = (
	error: unknown,
	res: Response,
): boolean => {
	if (!(error instanceof LocationError)) {
		return false;
	}

	const mapped = mapLocationError(error);
	res.status(mapped.status).json({ message: mapped.message, code: mapped.code });
	return true;
};
