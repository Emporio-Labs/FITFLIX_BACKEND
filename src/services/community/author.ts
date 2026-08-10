import mongoose from "mongoose";
import Admin from "../../models/Admin";
import { CommunityRole } from "../../models/Enums";
import Trainer from "../../models/Trainer";
import User from "../../models/User";
import {
	resolveAvatarUrl,
	resolveProfilesForAuthors,
} from "./profile.service";

export type AuthorBadgeRole = "member" | "trainer" | "admin";

export interface CommunityAuthor {
	id: string;
	name: string | null;
	role: AuthorBadgeRole;
	/** Signed URL for the author's 128px avatar thumbnail, or null. */
	avatarUrl: string | null;
}

/**
 * Resolve author { id, name, role, avatarUrl } for a batch of items using the
 * role snapshotted on each item (trainer/admin names live in their own
 * collections). At most one query per collection — no N+1.
 */
export async function resolveCommunityAuthors(
	items: { authorId: string; authorRole?: string }[],
): Promise<Map<string, CommunityAuthor>> {
	const roleById = new Map<string, AuthorBadgeRole>();
	const adminIds: string[] = [];
	const trainerIds: string[] = [];
	const memberIds: string[] = [];

	for (const item of items) {
		const id = String(item.authorId);
		if (roleById.has(id)) continue;
		if (item.authorRole === CommunityRole.Admin) {
			roleById.set(id, "admin");
			adminIds.push(id);
		} else if (item.authorRole === CommunityRole.Trainer) {
			roleById.set(id, "trainer");
			trainerIds.push(id);
		} else {
			roleById.set(id, "member");
			memberIds.push(id);
		}
	}

	// Four batched queries, never per-author. The profile lookup carries the
	// avatar and any display-name override.
	const [users, trainers, admins, profiles] = await Promise.all([
		memberIds.length
			? User.find({ _id: { $in: memberIds } })
					.select("username")
					.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>()
			: [],
		trainerIds.length
			? Trainer.find({ _id: { $in: trainerIds } })
					.select("trainerName imageUrl")
					.lean<
						{
							_id: mongoose.Types.ObjectId;
							trainerName?: string;
							imageUrl?: string;
						}[]
					>()
			: [],
		adminIds.length
			? Admin.find({ _id: { $in: adminIds } })
					.select("adminName")
					.lean<{ _id: mongoose.Types.ObjectId; adminName?: string }[]>()
			: [],
		resolveProfilesForAuthors([...memberIds, ...trainerIds, ...adminIds]),
	]);

	const map = new Map<string, CommunityAuthor>();
	for (const u of users)
		map.set(String(u._id), {
			id: String(u._id),
			name: profiles.get(String(u._id))?.displayName || u.username || null,
			role: "member",
			avatarUrl: null,
		});
	for (const t of trainers)
		map.set(String(t._id), {
			id: String(t._id),
			name: profiles.get(String(t._id))?.displayName || t.trainerName || null,
			role: "trainer",
			// Legacy trainer images live on the Trainer record; a community profile
			// avatar supersedes it.
			avatarUrl: profiles.get(String(t._id))?.avatarThumbKey || t.imageUrl || null,
		});
	for (const a of admins)
		map.set(String(a._id), {
			id: String(a._id),
			name: profiles.get(String(a._id))?.displayName || a.adminName || null,
			role: "admin",
			avatarUrl: null,
		});

	// Members and admins take their avatar straight from the profile collection.
	for (const [id, author] of map) {
		if (author.avatarUrl === null) {
			author.avatarUrl = profiles.get(id)?.avatarThumbKey || null;
		}
	}

	// Sign ONCE per distinct author, and only the 128px thumbnail — signing is a
	// local HMAC, but a feed page already signs ~40 media URLs, so there is no
	// reason to also sign a full-size avatar nobody renders here.
	await Promise.all(
		[...map.values()].map(async (author) => {
			author.avatarUrl = await resolveAvatarUrl(author.avatarUrl);
		}),
	);

	return map;
}

export function authorFor(
	item: { authorId: string; authorRole?: string },
	map: Map<string, CommunityAuthor>,
): CommunityAuthor {
	const id = String(item.authorId);
	return (
		map.get(id) ?? {
			id,
			name: null,
			role:
				item.authorRole === CommunityRole.Admin
					? "admin"
					: item.authorRole === CommunityRole.Trainer
						? "trainer"
						: "member",
			avatarUrl: null,
		}
	);
}
