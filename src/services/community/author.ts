import mongoose from "mongoose";
import Admin from "../../models/Admin";
import { CommunityRole } from "../../models/Enums";
import Trainer from "../../models/Trainer";
import User from "../../models/User";

export type AuthorBadgeRole = "member" | "trainer" | "admin";

export interface CommunityAuthor {
	id: string;
	name: string | null;
	role: AuthorBadgeRole;
}

/**
 * Resolve author { id, name, role } for a batch of items using the role
 * snapshotted on each item (trainer/admin names live in their own
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

	const [users, trainers, admins] = await Promise.all([
		memberIds.length
			? User.find({ _id: { $in: memberIds } })
					.select("username")
					.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>()
			: [],
		trainerIds.length
			? Trainer.find({ _id: { $in: trainerIds } })
					.select("trainerName")
					.lean<{ _id: mongoose.Types.ObjectId; trainerName?: string }[]>()
			: [],
		adminIds.length
			? Admin.find({ _id: { $in: adminIds } })
					.select("adminName")
					.lean<{ _id: mongoose.Types.ObjectId; adminName?: string }[]>()
			: [],
	]);

	const map = new Map<string, CommunityAuthor>();
	for (const u of users)
		map.set(String(u._id), {
			id: String(u._id),
			name: u.username ?? null,
			role: "member",
		});
	for (const t of trainers)
		map.set(String(t._id), {
			id: String(t._id),
			name: t.trainerName ?? null,
			role: "trainer",
		});
	for (const a of admins)
		map.set(String(a._id), {
			id: String(a._id),
			name: a.adminName ?? null,
			role: "admin",
		});

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
		}
	);
}
