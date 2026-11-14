/**
 * Chat directory: turns the three account collections into one shape.
 *
 * `User` holds members and the staff stored as users (`staffRole`); trainers
 * and admins have their own collections. Everything in chat addresses a person
 * as `{ kind, id }` and reasons about them by `ChatRole`.
 */
import mongoose from "mongoose";
import { normalizeRole } from "../../middleware/rbac.middleware";
import Admin from "../../models/Admin";
import type { ChatParticipantKind } from "../../models/ChatConversation";
import Trainer from "../../models/Trainer";
import User from "../../models/User";
import type { AuthenticatedUser } from "../../types/auth";

export const CHAT_ROLES = [
	"client",
	"trainer",
	"nutritionist",
	"sports_scientist",
	"doctor",
	"frontdesk",
	"admin",
] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const isChatRole = (value: unknown): value is ChatRole =>
	typeof value === "string" &&
	(CHAT_ROLES as readonly string[]).includes(value);

export const isStaffRole = (role: ChatRole): boolean => role !== "client";

/** Staff roles stored on `User.staffRole`. */
const USER_STAFF_ROLES: ChatRole[] = [
	"nutritionist",
	"sports_scientist",
	"doctor",
];

export interface ChatActor {
	kind: ChatParticipantKind;
	id: string;
	role: ChatRole;
}

export interface ChatPerson extends ChatActor {
	name: string;
	avatarUrl: string;
	active: boolean;
}

export const personKey = (p: { kind: string; id: string }): string =>
	`${p.kind}:${p.id}`;

/** The caller, from their token. */
export const actorFromAuth = (user: AuthenticatedUser): ChatActor => {
	const role = normalizeRole(user.role);
	if (role === "admin") return { kind: "Admin", id: user.id, role: "admin" };
	if (role === "trainer")
		return { kind: "Trainer", id: user.id, role: "trainer" };
	if (role === "user") return { kind: "User", id: user.id, role: "client" };
	return {
		kind: "User",
		id: user.id,
		role: isChatRole(role) ? role : "client",
	};
};

type UserLean = {
	_id: mongoose.Types.ObjectId;
	username?: string;
	email?: string;
	staffRole?: string | null;
	isActive?: boolean;
};
type TrainerLean = {
	_id: mongoose.Types.ObjectId;
	trainerName?: string;
	imageUrl?: string;
	isActive?: boolean;
};
type AdminLean = { _id: mongoose.Types.ObjectId; adminName?: string };

const USER_FIELDS = "username email staffRole isActive";
const TRAINER_FIELDS = "trainerName imageUrl isActive";

const fromUser = (u: UserLean): ChatPerson => ({
	kind: "User",
	id: String(u._id),
	role: isChatRole(u.staffRole) ? u.staffRole : "client",
	name: u.username?.trim() || u.email || "Member",
	avatarUrl: "",
	active: u.isActive !== false,
});

const fromTrainer = (t: TrainerLean): ChatPerson => ({
	kind: "Trainer",
	id: String(t._id),
	role: "trainer",
	name: t.trainerName?.trim() || "Trainer",
	avatarUrl: t.imageUrl ?? "",
	active: t.isActive !== false,
});

const fromAdmin = (a: AdminLean): ChatPerson => ({
	kind: "Admin",
	id: String(a._id),
	role: "admin",
	name: a.adminName?.trim() || "Admin",
	avatarUrl: "",
	active: true,
});

export const loadPerson = async (
	kind: ChatParticipantKind,
	id: string,
): Promise<ChatPerson | null> => {
	if (!mongoose.Types.ObjectId.isValid(id)) return null;
	if (kind === "User") {
		const u = await User.findById(id)
			.select(USER_FIELDS)
			.lean<UserLean | null>();
		return u ? fromUser(u) : null;
	}
	if (kind === "Trainer") {
		const t = await Trainer.findById(id)
			.select(TRAINER_FIELDS)
			.lean<TrainerLean | null>();
		return t ? fromTrainer(t) : null;
	}
	const a = await Admin.findById(id)
		.select("adminName")
		.lean<AdminLean | null>();
	return a ? fromAdmin(a) : null;
};

const escapeRegex = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ListPeopleOptions {
	search?: string;
	/** Restrict to these ids (an "assigned" list). */
	ids?: string[];
	limit?: number;
}

/** Active people holding `role`, optionally filtered. */
export const listPeople = async (
	role: ChatRole,
	options: ListPeopleOptions = {},
): Promise<ChatPerson[]> => {
	const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
	const search = options.search?.trim();
	const rx = search ? new RegExp(escapeRegex(search), "i") : null;
	const ids = options.ids?.filter((id) => mongoose.Types.ObjectId.isValid(id));
	if (options.ids && (!ids || ids.length === 0)) return [];

	if (role === "admin") {
		const filter: Record<string, unknown> = {};
		if (ids) filter._id = { $in: ids };
		if (rx) filter.$or = [{ adminName: rx }, { email: rx }];
		const rows = await Admin.find(filter)
			.select("adminName")
			.sort({ adminName: 1 })
			.limit(limit)
			.lean<AdminLean[]>();
		return rows.map(fromAdmin);
	}

	if (role === "trainer") {
		const filter: Record<string, unknown> = { isActive: { $ne: false } };
		if (ids) filter._id = { $in: ids };
		if (rx) filter.$or = [{ trainerName: rx }, { email: rx }];
		const rows = await Trainer.find(filter)
			.select(TRAINER_FIELDS)
			.sort({ trainerName: 1 })
			.limit(limit)
			.lean<TrainerLean[]>();
		return rows.map(fromTrainer);
	}

	// No account is stored as "frontdesk": desk staff sign in as admins.
	if (role === "frontdesk") return [];

	const filter: Record<string, unknown> = { isActive: { $ne: false } };
	if (role === "client") {
		// Matches null and missing — legacy members have no staffRole field.
		filter.staffRole = null;
	} else if (USER_STAFF_ROLES.includes(role)) {
		filter.staffRole = role;
	} else {
		return [];
	}
	if (ids) filter._id = { $in: ids };
	if (rx) filter.$or = [{ username: rx }, { email: rx }, { phone: rx }];
	const rows = await User.find(filter)
		.select(USER_FIELDS)
		.sort({ username: 1 })
		.limit(limit)
		.lean<UserLean[]>();
	if (role !== "client") return rows.map(fromUser);

	// A trainer usually also has a User record under the same email (it holds
	// their push subscriptions). That record is not a member — leave it out so
	// one person does not appear twice.
	const emails = rows.map((u) => u.email?.toLowerCase()).filter(Boolean);
	if (emails.length === 0) return rows.map(fromUser);
	const trainerEmails = new Set(
		(
			await Trainer.find({ email: { $in: emails } })
				.collation({ locale: "en", strength: 2 })
				.select("email")
				.lean<Array<{ email?: string }>>()
		).map((t) => t.email?.toLowerCase()),
	);
	return rows
		.filter((u) => !trainerEmails.has(u.email?.toLowerCase()))
		.map(fromUser);
};

/**
 * The trainer behind a plain User record with the same email, if there is one.
 * Lets "message this user" land on the trainer's real chat identity instead of
 * opening a second thread nobody will read.
 */
export const trainerTwinOf = async (
	userId: string,
): Promise<ChatPerson | null> => {
	if (!mongoose.Types.ObjectId.isValid(userId)) return null;
	const user = await User.findById(userId)
		.select("email staffRole")
		.lean<{ email?: string; staffRole?: string | null } | null>();
	if (!user?.email || user.staffRole) return null;
	const trainer = await Trainer.findOne({ email: user.email })
		.collation({ locale: "en", strength: 2 })
		.select(TRAINER_FIELDS)
		.lean<TrainerLean | null>();
	return trainer ? fromTrainer(trainer) : null;
};
