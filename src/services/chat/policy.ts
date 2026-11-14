/**
 * Who may chat with whom.
 *
 * Checked in this order:
 *
 *   1. Hard stops — yourself, an account with chat turned off, a block, and
 *      (when the setting is on) a member with no active membership.
 *   2. Role rules — a directional matrix "a <from-role> may start a chat with
 *      a <to-role>", each cell `none` | `assigned` | `all`. Admin rows and
 *      nothing else are locked to `all`.
 *   3. Per-person overrides — an admin toggle that lets one staff member reach
 *      all staff (`staffChat`) or all members (`allClients`).
 *   4. Relationships — for `assigned`, the resolver in `relationships.ts`.
 *
 * Starting is directional; replying is not. Once a thread exists, either side
 * may send as long as at least one direction is still allowed — so an admin
 * can message a member and the member can answer, without members being able
 * to open threads with admins. Hard stops are never lifted by the other
 * direction.
 */
import mongoose from "mongoose";
import { ChatBlock, ChatOverride, ChatPolicy } from "../../models/ChatPolicy";
import { MembershipStatus } from "../../models/Enums";
import Membership from "../../models/Membership";
import {
	CHAT_ROLES,
	type ChatActor,
	type ChatRole,
	isChatRole,
	isStaffRole,
	personKey,
} from "./people";
import { assignableRoles, getRelationship } from "./relationships";

export type ChatRuleMode = "none" | "assigned" | "all";

export interface ChatRule {
	from: ChatRole;
	to: ChatRole;
	mode: ChatRuleMode;
}

export interface ChatSettings {
	/** Members with no active membership can only reach admins and the front desk. */
	requireActiveMembership: boolean;
}

export interface ChatOverrideFlags {
	staffChat: boolean;
	allClients: boolean;
	chatDisabled: boolean;
}

const NO_OVERRIDE: ChatOverrideFlags = {
	staffChat: false,
	allClients: false,
	chatDisabled: false,
};

const ruleKey = (from: ChatRole, to: ChatRole): string => `${from}>${to}`;

/** Admin can always reach anyone; that row is not editable. */
export const isLockedRule = (from: ChatRole): boolean => from === "admin";

/** `assigned` only means something between a member and a role with a resolver. */
export const supportsAssigned = (from: ChatRole, to: ChatRole): boolean => {
	if (from === "client" && to !== "client")
		return assignableRoles().includes(to);
	if (to === "client" && from !== "client")
		return assignableRoles().includes(from);
	return false;
};

export const defaultMode = (from: ChatRole, to: ChatRole): ChatRuleMode => {
	if (from === "admin") return "all";
	// Staff can raise things with an admin; members wait to be contacted.
	if (to === "admin") return from === "client" ? "none" : "all";
	if (from === "client" && to === "client") return "none";
	if (from === "client" || to === "client") {
		// Front desk is the open door for members; everyone else is by assignment.
		return supportsAssigned(from, to) ? "assigned" : "all";
	}
	// Staff ↔ staff is off until an admin turns it on.
	return "none";
};

/** Roles a member can always reach, membership or not — that is how they renew. */
const MEMBERSHIP_EXEMPT: ChatRole[] = ["admin", "frontdesk"];

// ── Stored policy (cached in-process) ────────────────────────────────────────

interface StoredPolicy {
	rules: Map<string, ChatRuleMode>;
	settings: ChatSettings;
}

const CACHE_TTL_MS = 15_000;
let cached: { at: number; policy: StoredPolicy } | null = null;

export const invalidatePolicyCache = (): void => {
	cached = null;
};

const loadStoredPolicy = async (): Promise<StoredPolicy> => {
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.policy;
	const doc = await ChatPolicy.findOne().lean<{
		rules?: Array<{ from: string; to: string; mode: ChatRuleMode }>;
		requireActiveMembership?: boolean;
	} | null>();
	const rules = new Map<string, ChatRuleMode>();
	for (const r of doc?.rules ?? []) {
		if (!isChatRole(r.from) || !isChatRole(r.to)) continue;
		if (isLockedRule(r.from)) continue;
		if (r.mode === "assigned" && !supportsAssigned(r.from, r.to)) continue;
		rules.set(ruleKey(r.from, r.to), r.mode);
	}
	const policy: StoredPolicy = {
		rules,
		settings: {
			requireActiveMembership: doc?.requireActiveMembership !== false,
		},
	};
	cached = { at: Date.now(), policy };
	return policy;
};

export interface ChatRuleView extends ChatRule {
	defaultMode: ChatRuleMode;
	locked: boolean;
	supportsAssigned: boolean;
}

/** The full matrix, defaults filled in — what the admin screen edits. */
export const getPolicyMatrix = async (): Promise<ChatRuleView[]> => {
	const { rules: stored } = await loadStoredPolicy();
	const out: ChatRuleView[] = [];
	for (const from of CHAT_ROLES) {
		for (const to of CHAT_ROLES) {
			const fallback = defaultMode(from, to);
			out.push({
				from,
				to,
				mode: isLockedRule(from)
					? "all"
					: (stored.get(ruleKey(from, to)) ?? fallback),
				defaultMode: fallback,
				locked: isLockedRule(from),
				supportsAssigned: supportsAssigned(from, to),
			});
		}
	}
	return out;
};

export const getChatSettings = async (): Promise<ChatSettings> =>
	(await loadStoredPolicy()).settings;

export const updateChatSettings = async (
	changes: Partial<ChatSettings>,
	updatedBy: string,
): Promise<ChatSettings> => {
	await ChatPolicy.findOneAndUpdate(
		{},
		{ $set: { ...changes, updatedBy } },
		{ upsert: true },
	);
	invalidatePolicyCache();
	return getChatSettings();
};

export class ChatPolicyError extends Error {}

/** Merge edited cells into the stored policy. Cells equal to the default are dropped. */
export const updatePolicy = async (
	changes: ChatRule[],
	updatedBy: string,
): Promise<ChatRuleView[]> => {
	const stored = new Map((await loadStoredPolicy()).rules);
	for (const change of changes) {
		if (isLockedRule(change.from)) {
			throw new ChatPolicyError("Admin rules cannot be changed");
		}
		if (
			change.mode === "assigned" &&
			!supportsAssigned(change.from, change.to)
		) {
			throw new ChatPolicyError(
				`"Assigned only" is not available between ${change.from} and ${change.to}`,
			);
		}
		const key = ruleKey(change.from, change.to);
		if (change.mode === defaultMode(change.from, change.to)) stored.delete(key);
		else stored.set(key, change.mode);
	}
	const rules = Array.from(stored.entries()).map(([key, mode]) => {
		const [from, to] = key.split(">");
		return { from, to, mode };
	});
	await ChatPolicy.findOneAndUpdate(
		{},
		{ $set: { rules, updatedBy } },
		{ upsert: true },
	);
	invalidatePolicyCache();
	return getPolicyMatrix();
};

export const resetPolicy = async (
	updatedBy: string,
): Promise<ChatRuleView[]> => {
	await ChatPolicy.findOneAndUpdate(
		{},
		{ $set: { rules: [], updatedBy } },
		{ upsert: true },
	);
	invalidatePolicyCache();
	return getPolicyMatrix();
};

// ── Decisions ────────────────────────────────────────────────────────────────

export type ChatDenyReason =
	| "SELF"
	| "CHAT_DISABLED"
	| "RECIPIENT_UNAVAILABLE"
	| "BLOCKED"
	| "BLOCKED_BY_YOU"
	| "MEMBERSHIP_INACTIVE"
	| "NOT_ALLOWED"
	| "NOT_ASSIGNED";

/** Reasons the other direction being allowed must not override. */
const HARD_STOPS: ChatDenyReason[] = [
	"SELF",
	"CHAT_DISABLED",
	"RECIPIENT_UNAVAILABLE",
	"BLOCKED",
	"BLOCKED_BY_YOU",
	"MEMBERSHIP_INACTIVE",
];

export interface ChatDecision {
	allowed: boolean;
	reason?: ChatDenyReason;
}

const ALLOW: ChatDecision = { allowed: true };
const deny = (reason: ChatDenyReason): ChatDecision => ({
	allowed: false,
	reason,
});

export const DENY_MESSAGES: Record<ChatDenyReason, string> = {
	SELF: "You cannot message yourself",
	CHAT_DISABLED: "Chat has been turned off for your account",
	RECIPIENT_UNAVAILABLE: "This person is not available on chat",
	// Deliberately the same words as "unavailable": being blocked is not
	// announced to the person who was blocked.
	BLOCKED: "This person is not available on chat",
	BLOCKED_BY_YOU:
		"You have blocked this person. Unblock them to send a message",
	MEMBERSHIP_INACTIVE: "Chat is available with an active membership",
	NOT_ALLOWED: "You are not allowed to message this person",
	NOT_ASSIGNED: "You can only message people assigned to you",
};

const oid = (id: string) => new mongoose.Types.ObjectId(id);

/**
 * One request's worth of policy state. Rules, overrides, blocks, memberships
 * and roster lookups are loaded once and reused, so checking a whole inbox
 * costs a handful of queries rather than a handful per thread.
 */
export class PolicyContext {
	private policy: StoredPolicy | null = null;
	private overrides = new Map<string, ChatOverrideFlags>();
	private clientIds = new Map<string, Promise<Set<string>>>();
	/** personKey → keys of people they blocked. */
	private blocksBy = new Map<string, Set<string>>();
	/** client id → has an active membership. */
	private memberships = new Map<string, boolean>();

	private async stored(): Promise<StoredPolicy> {
		if (!this.policy) this.policy = await loadStoredPolicy();
		return this.policy;
	}

	async mode(from: ChatRole, to: ChatRole): Promise<ChatRuleMode> {
		if (isLockedRule(from)) return "all";
		const { rules } = await this.stored();
		return rules.get(ruleKey(from, to)) ?? defaultMode(from, to);
	}

	/** Load overrides, blocks and memberships for several people in a few queries. */
	async prime(people: ChatActor[]): Promise<void> {
		await Promise.all([
			this.primeOverrides(people),
			this.primeBlocks(people),
			this.primeMemberships(people),
		]);
	}

	async primeOverrides(
		people: Array<{ kind: string; id: string }>,
	): Promise<void> {
		const missing = people.filter((p) => !this.overrides.has(personKey(p)));
		if (missing.length === 0) return;
		const rows = await ChatOverride.find({
			personId: { $in: missing.map((p) => p.id) },
		}).lean<
			Array<{
				kind: string;
				personId: unknown;
				staffChat?: boolean;
				allClients?: boolean;
				chatDisabled?: boolean;
			}>
		>();
		for (const p of missing) this.overrides.set(personKey(p), NO_OVERRIDE);
		for (const row of rows) {
			this.overrides.set(
				personKey({ kind: row.kind, id: String(row.personId) }),
				{
					staffChat: Boolean(row.staffChat),
					allClients: Boolean(row.allClients),
					chatDisabled: Boolean(row.chatDisabled),
				},
			);
		}
	}

	async override(person: {
		kind: string;
		id: string;
	}): Promise<ChatOverrideFlags> {
		await this.primeOverrides([person]);
		return this.overrides.get(personKey(person)) ?? NO_OVERRIDE;
	}

	private async primeBlocks(
		people: Array<{ kind: string; id: string }>,
	): Promise<void> {
		const missing = people.filter((p) => !this.blocksBy.has(personKey(p)));
		if (missing.length === 0) return;
		const rows = await ChatBlock.find({
			blockerId: { $in: missing.map((p) => p.id) },
		}).lean<
			Array<{
				blockerKind: string;
				blockerId: unknown;
				blockedKind: string;
				blockedId: unknown;
			}>
		>();
		for (const p of missing) this.blocksBy.set(personKey(p), new Set());
		for (const row of rows) {
			this.blocksBy
				.get(personKey({ kind: row.blockerKind, id: String(row.blockerId) }))
				?.add(personKey({ kind: row.blockedKind, id: String(row.blockedId) }));
		}
	}

	/** Has `blocker` blocked `blocked`? */
	async hasBlocked(blocker: ChatActor, blocked: ChatActor): Promise<boolean> {
		await this.primeBlocks([blocker]);
		return (
			this.blocksBy.get(personKey(blocker))?.has(personKey(blocked)) ?? false
		);
	}

	private async primeMemberships(people: ChatActor[]): Promise<void> {
		const { settings } = await this.stored();
		if (!settings.requireActiveMembership) return;
		const missing = people
			.filter((p) => p.role === "client" && !this.memberships.has(p.id))
			.map((p) => p.id);
		if (missing.length === 0) return;
		const now = new Date();
		// Same definition as getActiveMembership (utils/membership.guard.ts).
		const active = await Membership.distinct("user", {
			user: { $in: missing.map(oid) },
			status: MembershipStatus.Active,
			startDate: { $lte: now },
			$or: [
				{ endDate: null },
				{ endDate: { $exists: false } },
				{ endDate: { $gte: now } },
			],
		});
		const activeIds = new Set(active.map(String));
		for (const id of missing) this.memberships.set(id, activeIds.has(id));
	}

	/** Does the membership rule stop these two from talking? */
	private async membershipBlocks(a: ChatActor, b: ChatActor): Promise<boolean> {
		const { settings } = await this.stored();
		if (!settings.requireActiveMembership) return false;
		for (const [client, other] of [
			[a, b],
			[b, a],
		] as const) {
			if (client.role !== "client") continue;
			if (MEMBERSHIP_EXEMPT.includes(other.role)) continue;
			await this.primeMemberships([client]);
			if (!this.memberships.get(client.id)) return true;
		}
		return false;
	}

	/** Members assigned to this staff member (memoised). */
	clientIdsOf(staff: ChatActor): Promise<Set<string>> {
		const key = personKey(staff);
		let pending = this.clientIds.get(key);
		if (!pending) {
			const resolver = getRelationship(staff.role);
			pending = resolver
				? resolver.clientIdsOf(staff.id).then((ids) => new Set(ids))
				: Promise.resolve(new Set<string>());
			this.clientIds.set(key, pending);
		}
		return pending;
	}

	private async isAssigned(a: ChatActor, b: ChatActor): Promise<boolean> {
		const [staff, client] = a.role === "client" ? [b, a] : [a, b];
		if (client.role !== "client" || staff.role === "client") return false;
		return (await this.clientIdsOf(staff)).has(client.id);
	}

	/** May `from` open a new thread with `to`? */
	async canStart(from: ChatActor, to: ChatActor): Promise<ChatDecision> {
		if (from.kind === to.kind && from.id === to.id) return deny("SELF");

		const [fromFlags, toFlags] = await Promise.all([
			this.override(from),
			this.override(to),
		]);
		// Admins are never shut out of chat.
		if (from.role !== "admin" && fromFlags.chatDisabled)
			return deny("CHAT_DISABLED");
		if (to.role !== "admin" && toFlags.chatDisabled) {
			return deny("RECIPIENT_UNAVAILABLE");
		}

		// A block cuts both ways. Admins neither block nor get blocked.
		if (from.role !== "admin" && to.role !== "admin") {
			if (await this.hasBlocked(from, to)) return deny("BLOCKED_BY_YOU");
			if (await this.hasBlocked(to, from)) return deny("BLOCKED");
		}

		if (await this.membershipBlocks(from, to)) {
			return deny(
				from.role === "client"
					? "MEMBERSHIP_INACTIVE"
					: "RECIPIENT_UNAVAILABLE",
			);
		}

		if (from.role === "admin") return ALLOW;

		const mode = await this.mode(from.role, to.role);
		if (mode === "all") return ALLOW;

		if (isStaffRole(from.role)) {
			if (to.role === "client" && fromFlags.allClients) return ALLOW;
			if (isStaffRole(to.role) && to.role !== "admin" && fromFlags.staffChat) {
				return ALLOW;
			}
		}

		if (mode === "assigned") {
			return (await this.isAssigned(from, to)) ? ALLOW : deny("NOT_ASSIGNED");
		}
		return deny("NOT_ALLOWED");
	}

	/** May `from` send in an existing thread with `to`? */
	async canSend(from: ChatActor, to: ChatActor): Promise<ChatDecision> {
		const forward = await this.canStart(from, to);
		if (forward.allowed) return forward;
		if (forward.reason && HARD_STOPS.includes(forward.reason)) return forward;
		const reverse = await this.canStart(to, from);
		return reverse.allowed ? ALLOW : forward;
	}
}

/** One-off check for other modules ("show a Message button?"). */
export const canStartChat = (
	from: ChatActor,
	to: ChatActor,
): Promise<ChatDecision> => new PolicyContext().canStart(from, to);
