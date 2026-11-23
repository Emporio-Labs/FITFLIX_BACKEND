import mongoose from "mongoose";
import Admin from "../models/Admin";
import Trainer from "../models/Trainer";

/**
 * Which exercises a requester may see and use.
 *
 * Exercises created by gym staff (trainers, admins) belong to the gym's shared
 * library: every trainer must be able to pick them in plans and live sessions,
 * and members must receive them when a session is seeded from a plan. Only an
 * exercise a member created for themselves stays private to that member.
 *
 * Before this, visibility was "system or created by me", so an exercise one
 * trainer created was invisible to every other trainer and was silently
 * dropped from a member's session when the member started it.
 */

const STAFF_ID_TTL_MS = 60_000;
let staffIdCache: { ids: mongoose.Types.ObjectId[]; at: number } | null = null;

const loadStaffIds = async (): Promise<mongoose.Types.ObjectId[]> => {
	if (staffIdCache && Date.now() - staffIdCache.at < STAFF_ID_TTL_MS) {
		return staffIdCache.ids;
	}
	const [trainerIds, adminIds] = await Promise.all([
		Trainer.distinct("_id"),
		Admin.distinct("_id"),
	]);
	const ids = [...trainerIds, ...adminIds] as mongoose.Types.ObjectId[];
	staffIdCache = { ids, at: Date.now() };
	return ids;
};

/** `$or` clauses matching every exercise visible to `requesterId`. */
export const visibleExerciseClauses = async (
	requesterId: string | undefined,
): Promise<Record<string, unknown>[]> => {
	const staffIds = await loadStaffIds();
	const or: Record<string, unknown>[] = [
		{ isSystem: true },
		{ createdBy: { $in: staffIds } },
	];
	if (requesterId && mongoose.Types.ObjectId.isValid(requesterId)) {
		or.push({ createdBy: new mongoose.Types.ObjectId(requesterId) });
	}
	return or;
};

/** True when `createdBy` is a staff account (shared library exercise). */
export const isStaffAuthored = async (
	createdBy: unknown,
): Promise<boolean> => {
	if (!createdBy) return false;
	const id = String(createdBy);
	const staffIds = await loadStaffIds();
	return staffIds.some((s) => s.toString() === id);
};
