import mongoose from "mongoose";
import { communityConfig } from "../../config/community";
import Admin from "../../models/Admin";
import CommunityProfile from "../../models/CommunityProfile";
import { CommunityRole, PostStatus } from "../../models/Enums";
import Post from "../../models/Post";
import Trainer from "../../models/Trainer";
import User from "../../models/User";
import { deleteFromS3, generateSignedUrl } from "../../utils/s3.service";
import type { AuthorBadgeRole } from "./author";
import { getBlockedUserIds } from "./block.service";
import { type FeedCursor, encodeCursor } from "./cursor";

/** Which collection a profile's owner lives in. */
export type OwnerType = "user" | "trainer" | "admin";

export class ProfileNotFoundError extends Error {
	status = 404;
	code = "NOT_FOUND";
	constructor() {
		super("Profile not found");
		this.name = "ProfileNotFoundError";
	}
}

interface LeanProfile {
	_id: mongoose.Types.ObjectId;
	ownerId: mongoose.Types.ObjectId;
	ownerType?: OwnerType;
	displayName?: string;
	bio?: string;
	avatarKey?: string;
	avatarThumbKey?: string;
	avatarUpdatedAt?: Date | null;
}

/**
 * The public shape of a profile. Hand-built, field by field — see
 * {@link buildPublicProfile} for why that matters.
 */
export interface PublicProfile {
	id: string;
	name: string | null;
	role: AuthorBadgeRole;
	bio: string;
	avatarUrl: string | null;
	avatarThumbUrl: string | null;
	/** "YYYY-MM". Month precision only — never a full date. */
	memberSince: string | null;
	postCount: number;
	isSelf: boolean;
	isBlocked: boolean;
}

/** A thin people-search hit. Deliberately NOT a PublicProfile: computing
 *  postCount per row would be an N+1 of countDocuments. */
export interface PersonResult {
	id: string;
	name: string | null;
	role: AuthorBadgeRole;
	avatarThumbUrl: string | null;
	bio: string;
	isSelf: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Avatar URL resolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Turn a stored avatar reference into something the client can render.
 *
 * Community avatars are stored as S3 KEYS and signed for 900s on read, like all
 * other community media. `Trainer.imageUrl` predates this module and is a
 * free-form string that may already be an absolute URL — so an http(s) value is
 * passed through untouched and anything else is treated as a key. This is the
 * ONLY place that rule lives.
 */
export async function resolveAvatarUrl(
	keyOrUrl: string | null | undefined,
): Promise<string | null> {
	const value = (keyOrUrl ?? "").trim();
	if (!value) return null;
	if (value.startsWith("http://") || value.startsWith("https://")) return value;
	return generateSignedUrl(value, 900, "image/jpeg");
}

// ────────────────────────────────────────────────────────────────────────────
// Owner identification
// ────────────────────────────────────────────────────────────────────────────

interface OwnerIdentity {
	id: string;
	type: OwnerType;
	role: AuthorBadgeRole;
	name: string | null;
	/** Fallback bio — trainers carry a description from the marketing site. */
	fallbackBio: string;
	/** Fallback avatar — trainers already have an imageUrl. */
	fallbackAvatar: string;
	createdAt: Date | null;
}

/**
 * Find which collection `id` belongs to and read ONLY the fields a public
 * profile may expose. The `.select(...)` calls here are deliberately narrow:
 * they are what stops a profile read from ever touching phone, email, age,
 * gender, dateOfBirth or address.
 */
async function identifyOwner(id: string): Promise<OwnerIdentity | null> {
	if (!mongoose.isValidObjectId(id)) return null;

	const [user, trainer, admin] = await Promise.all([
		User.findById(id)
			.select("username createdAt")
			.lean<{ _id: mongoose.Types.ObjectId; username?: string; createdAt?: Date }>(),
		Trainer.findById(id)
			.select("trainerName description imageUrl createdAt")
			.lean<{
				_id: mongoose.Types.ObjectId;
				trainerName?: string;
				description?: string;
				imageUrl?: string;
				createdAt?: Date;
			}>(),
		Admin.findById(id)
			.select("adminName createdAt")
			.lean<{ _id: mongoose.Types.ObjectId; adminName?: string; createdAt?: Date }>(),
	]);

	if (trainer) {
		return {
			id,
			type: "trainer",
			role: "trainer",
			name: trainer.trainerName ?? null,
			fallbackBio: trainer.description ?? "",
			fallbackAvatar: trainer.imageUrl ?? "",
			createdAt: trainer.createdAt ?? null,
		};
	}
	if (admin) {
		return {
			id,
			type: "admin",
			role: "admin",
			name: admin.adminName ?? null,
			fallbackBio: "",
			fallbackAvatar: "",
			createdAt: admin.createdAt ?? null,
		};
	}
	if (user) {
		return {
			id,
			type: "user",
			role: "member",
			name: user.username ?? null,
			fallbackBio: "",
			fallbackAvatar: "",
			createdAt: user.createdAt ?? null,
		};
	}
	return null;
}

/** "YYYY-MM" — month precision so a join date can never be mined as a birthday
 *  or correlated to an exact signup event. */
function monthStamp(date: Date | null): string | null {
	if (!date) return null;
	const d = new Date(date);
	if (Number.isNaN(d.getTime())) return null;
	return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────────────────

async function findProfile(ownerId: string): Promise<LeanProfile | null> {
	if (!mongoose.isValidObjectId(ownerId)) return null;
	return CommunityProfile.findOne({ ownerId }).lean<LeanProfile>();
}

/**
 * Build the public view of a profile.
 *
 * THIS FUNCTION IS THE PRIVACY GUARANTEE for the whole feature. It never calls
 * `user.toJSON()` (which would return the entire document — phone, email, age,
 * gender, dateOfBirth, address); it reads a narrow `.select()` and assembles
 * the response one field at a time. Any future field must be added here
 * explicitly, which makes an accidental leak impossible to introduce silently.
 */
export async function buildPublicProfile(
	targetId: string,
	viewer: { id: string },
): Promise<PublicProfile> {
	const owner = await identifyOwner(targetId);
	if (!owner) throw new ProfileNotFoundError();

	const isSelf = String(viewer.id) === String(targetId);

	const [profile, postCount, blockedIds] = await Promise.all([
		findProfile(targetId),
		Post.countDocuments({
			authorId: targetId,
			deletedAt: null,
			status: PostStatus.Published,
		}),
		isSelf ? Promise.resolve<string[]>([]) : getBlockedUserIds(viewer.id),
	]);

	const displayName = (profile?.displayName ?? "").trim();
	const bio = (profile?.bio ?? "").trim() || owner.fallbackBio;

	const [avatarUrl, avatarThumbUrl] = await Promise.all([
		resolveAvatarUrl(profile?.avatarKey || owner.fallbackAvatar),
		resolveAvatarUrl(
			profile?.avatarThumbKey || profile?.avatarKey || owner.fallbackAvatar,
		),
	]);

	return {
		id: String(targetId),
		name: displayName || owner.name,
		role: owner.role,
		bio,
		avatarUrl,
		avatarThumbUrl,
		memberSince: monthStamp(owner.createdAt),
		// Counts members_only posts too: those still appear in the profile's post
		// list as locked stubs, so excluding them would make the number disagree
		// with the list right below it.
		postCount,
		isSelf,
		isBlocked: blockedIds.includes(String(targetId)),
	};
}

/** The caller's own profile. Same shape as the public one, so the client has a
 *  single model for both. */
export async function getMyProfile(userId: string): Promise<PublicProfile> {
	return buildPublicProfile(userId, { id: userId });
}

// ────────────────────────────────────────────────────────────────────────────
// Writes (lazy upsert — no document exists until the owner edits something)
// ────────────────────────────────────────────────────────────────────────────

async function upsertProfile(
	ownerId: string,
	ownerType: OwnerType,
	update: Record<string, unknown>,
): Promise<void> {
	// The updated document is not read back — every caller re-reads through
	// getMyProfile so the response always goes through buildPublicProfile (the
	// one place that decides what is safe to expose).
	await CommunityProfile.updateOne(
		{ ownerId },
		{ $set: { ...update, ownerType } },
		{ upsert: true, setDefaultsOnInsert: true },
	);
}

export async function updateMyProfile(
	ownerId: string,
	ownerType: OwnerType,
	patch: { displayName?: string; bio?: string },
): Promise<PublicProfile> {
	const update: Record<string, unknown> = {};
	// An explicitly-sent empty string means "clear this field", matching how the
	// post editor treats an empty title.
	if (patch.displayName !== undefined) {
		update.displayName = patch.displayName
			.trim()
			.slice(0, communityConfig.profile.maxDisplayNameLength);
	}
	if (patch.bio !== undefined) {
		update.bio = patch.bio.trim().slice(0, communityConfig.profile.maxBioLength);
	}

	if (Object.keys(update).length > 0) {
		await upsertProfile(ownerId, ownerType, update);
	}
	return getMyProfile(ownerId);
}

/**
 * Point the profile at a freshly uploaded avatar and best-effort delete the
 * previous one.
 *
 * The new keys always live under a fresh uuid (see avatar.service), so the old
 * object is never overwritten. That is what lets the Flutter client treat the
 * object path as a stable cache key: a replaced avatar has a NEW path, so it is
 * a guaranteed cache miss rather than a stale hit that never expires.
 */
export async function setAvatar(
	ownerId: string,
	ownerType: OwnerType,
	keys: { avatarKey: string; avatarThumbKey: string },
): Promise<PublicProfile> {
	const previous = await findProfile(ownerId);

	await upsertProfile(ownerId, ownerType, {
		avatarKey: keys.avatarKey,
		avatarThumbKey: keys.avatarThumbKey,
		avatarUpdatedAt: new Date(),
	});

	await discardAvatarObjects(previous);
	return getMyProfile(ownerId);
}

export async function clearAvatar(
	ownerId: string,
	ownerType: OwnerType,
): Promise<PublicProfile> {
	const previous = await findProfile(ownerId);

	await upsertProfile(ownerId, ownerType, {
		avatarKey: "",
		avatarThumbKey: "",
		avatarUpdatedAt: new Date(),
	});

	await discardAvatarObjects(previous);
	return getMyProfile(ownerId);
}

/** Best-effort cleanup of superseded avatar objects. Never throws: a leaked S3
 *  object is a housekeeping problem, not a reason to fail the user's request. */
async function discardAvatarObjects(profile: LeanProfile | null): Promise<void> {
	if (!profile) return;
	const keys = [profile.avatarKey, profile.avatarThumbKey].filter(
		(k): k is string => Boolean(k && !k.startsWith("http")),
	);
	await Promise.all(keys.map((k) => deleteFromS3(k).catch(() => {})));
}

// ────────────────────────────────────────────────────────────────────────────
// Batch helper for the author resolver
// ────────────────────────────────────────────────────────────────────────────

export interface ProfileSummary {
	displayName: string;
	avatarThumbKey: string;
}

/**
 * Batch-load profile summaries for a set of author ids. One query, no N+1 —
 * called once per feed/comment page by {@link resolveCommunityAuthors}.
 */
export async function resolveProfilesForAuthors(
	ids: string[],
): Promise<Map<string, ProfileSummary>> {
	const valid = ids.filter((id) => mongoose.isValidObjectId(id));
	if (valid.length === 0) return new Map();

	const rows = await CommunityProfile.find({ ownerId: { $in: valid } })
		.select("ownerId displayName avatarThumbKey avatarKey")
		.lean<LeanProfile[]>();

	const map = new Map<string, ProfileSummary>();
	for (const row of rows) {
		map.set(String(row.ownerId), {
			displayName: (row.displayName ?? "").trim(),
			// Fall back to the full-size key so an avatar still renders if a thumb
			// was never generated (e.g. a profile written by an older build).
			avatarThumbKey: row.avatarThumbKey || row.avatarKey || "",
		});
	}
	return map;
}

// ────────────────────────────────────────────────────────────────────────────
// People search
// ────────────────────────────────────────────────────────────────────────────

/** Escape user input before it reaches a $regex. */
function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find people by name.
 *
 * Searches `User.username` and `Trainer.trainerName` DIRECTLY rather than the
 * profile collection, because profiles are created lazily — on day one almost
 * nobody has one, so searching profiles would return nearly nothing. Profiles
 * are then batch-joined for avatars and bios.
 *
 * Admins are excluded: staff accounts are not discoverable.
 */
export async function searchPeople(
	viewerId: string,
	rawQuery: string,
	params: { cursor?: FeedCursor | null; limit?: number } = {},
): Promise<{ people: PersonResult[]; nextCursor: string | null }> {
	const query = rawQuery.trim();
	if (!query) return { people: [], nextCursor: null };

	const limit = Math.min(
		params.limit ?? communityConfig.feed.defaultPageSize,
		communityConfig.feed.maxPageSize,
	);
	// Prefix-anchored so the index on `username` is at least scannable and a
	// two-letter query cannot match the middle of every name in the gym.
	const rx = new RegExp(`^${escapeRegex(query)}`, "i");
	const blockedIds = await getBlockedUserIds(viewerId);

	const filter: Record<string, unknown> = {
		username: rx,
		_id: { $nin: blockedIds.map((id) => new mongoose.Types.ObjectId(id)) },
	};
	if (params.cursor) {
		const at = new Date(params.cursor.createdAt);
		const id = new mongoose.Types.ObjectId(params.cursor.id);
		filter.$or = [
			{ createdAt: { $lt: at } },
			{ createdAt: at, _id: { $lt: id } },
		];
	}

	// One extra row reveals whether another page exists.
	const found = await User.find(filter)
		.sort({ createdAt: -1, _id: -1 })
		.limit(limit + 1)
		.select("username createdAt")
		.lean<{ _id: mongoose.Types.ObjectId; username?: string; createdAt: Date }[]>();

	const hasMore = found.length > limit;
	const rows = hasMore ? found.slice(0, limit) : found;

	// Trainers live in a different collection, so they cannot participate in the
	// keyset without breaking the cursor. They lead page ONE only — the same
	// trick the feed uses for pinned posts.
	const isFirstPage = !params.cursor;
	const trainers = isFirstPage
		? await Trainer.find({
				trainerName: rx,
				isActive: { $ne: false },
				_id: { $nin: blockedIds.map((id) => new mongoose.Types.ObjectId(id)) },
			})
				.limit(communityConfig.profile.searchTrainerLead)
				.select("trainerName description imageUrl")
				.lean<
					{
						_id: mongoose.Types.ObjectId;
						trainerName?: string;
						description?: string;
						imageUrl?: string;
					}[]
				>()
		: [];

	const profileMap = await resolveProfilesForAuthors([
		...rows.map((r) => String(r._id)),
		...trainers.map((t) => String(t._id)),
	]);

	const trainerHits: PersonResult[] = await Promise.all(
		trainers.map(async (t) => {
			const id = String(t._id);
			const profile = profileMap.get(id);
			return {
				id,
				name: profile?.displayName || t.trainerName || null,
				role: "trainer" as const,
				avatarThumbUrl: await resolveAvatarUrl(
					profile?.avatarThumbKey || t.imageUrl,
				),
				bio: t.description ?? "",
				isSelf: id === String(viewerId),
			};
		}),
	);

	const memberHits: PersonResult[] = await Promise.all(
		rows.map(async (r) => {
			const id = String(r._id);
			const profile = profileMap.get(id);
			return {
				id,
				name: profile?.displayName || r.username || null,
				role: "member" as const,
				avatarThumbUrl: await resolveAvatarUrl(profile?.avatarThumbKey),
				bio: "",
				isSelf: id === String(viewerId),
			};
		}),
	);

	// A trainer who also has a User record must not appear twice.
	const seen = new Set(trainerHits.map((t) => t.id));
	const people = [...trainerHits, ...memberHits.filter((m) => !seen.has(m.id))];

	const last = rows[rows.length - 1];
	return {
		people,
		nextCursor:
			hasMore && last
				? encodeCursor({
						createdAt: new Date(last.createdAt).toISOString(),
						id: String(last._id),
					})
				: null,
	};
}

/** Whether `viewerId` and `targetId` have blocked each other in either
 *  direction. Callers turn a true into a 404 (never a 403 — that would leak
 *  the account's existence). */
export async function isBlockedBetween(
	viewerId: string,
	targetId: string,
): Promise<boolean> {
	if (String(viewerId) === String(targetId)) return false;
	const blocked = await getBlockedUserIds(viewerId);
	return blocked.includes(String(targetId));
}

/** Map the JWT identity role onto a profile ownerType. Uses `req.user.role`,
 *  NOT the derived community role — a User with `communityRole: "trainer"` is
 *  still a User. */
export function ownerTypeForRole(role: string | undefined): OwnerType {
	if (role === "admin") return "admin";
	if (role === CommunityRole.Trainer) return "trainer";
	return "user";
}
