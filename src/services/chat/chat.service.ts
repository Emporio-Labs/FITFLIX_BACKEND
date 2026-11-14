/**
 * Direct messaging between members and staff.
 *
 * Permission is never cached on a thread: every open and every send goes back
 * through PolicyContext (see policy.ts).
 */
import mongoose from "mongoose";
import Admin from "../../models/Admin";
import ChatConversation, {
	type ChatParticipantKind,
} from "../../models/ChatConversation";
import ChatMessage, { CHAT_MESSAGE_MAX_LENGTH } from "../../models/ChatMessage";
import {
	ChatBlock,
	ChatOverride,
	ChatReport,
	type ChatReportReason,
} from "../../models/ChatPolicy";
import User from "../../models/User";
import { resolveTrainerUserId } from "../../utils/expert-user.resolver";
import { sendPushToUser } from "../fcm.service";
import { emitChatEvent, isAttentive } from "../realtime.service";
import { sendWebPushToUser } from "../webpush.service";
import {
	CHAT_ROLES,
	type ChatActor,
	type ChatPerson,
	type ChatRole,
	isChatRole,
	listPeople,
	loadPerson,
	personKey,
	trainerTwinOf,
} from "./people";
import { type ChatDenyReason, DENY_MESSAGES, PolicyContext } from "./policy";
import { getRelationship } from "./relationships";

export class ChatError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string,
		message: string,
		public readonly reason?: ChatDenyReason,
	) {
		super(message);
		this.name = "ChatError";
	}
}

const notFound = (what = "Conversation") =>
	new ChatError(404, "NOT_FOUND", `${what} not found`);
const denied = (reason: ChatDenyReason = "NOT_ALLOWED") =>
	new ChatError(403, "FORBIDDEN", DENY_MESSAGES[reason], reason);
const badRequest = (message: string) =>
	new ChatError(400, "BAD_REQUEST", message);

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const DELETED_PREVIEW = "Message deleted";

// ── Shapes ───────────────────────────────────────────────────────────────────

type ParticipantLean = {
	kind: ChatParticipantKind;
	id: mongoose.Types.ObjectId;
	role: string;
	name: string;
	avatarUrl: string;
	unreadCount: number;
	lastReadAt: Date | null;
};

type ConversationLean = {
	_id: mongoose.Types.ObjectId;
	type: string;
	participants: ParticipantLean[];
	lastMessage: {
		id?: unknown;
		body: string;
		senderId: unknown;
		at: Date | null;
	} | null;
	lastMessageAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type MessageLean = {
	_id: mongoose.Types.ObjectId;
	conversationId: mongoose.Types.ObjectId;
	senderKind: ChatParticipantKind;
	senderId: mongoose.Types.ObjectId;
	senderRole: string;
	senderName: string;
	body: string;
	clientMessageId?: string;
	deletedAt?: Date | null;
	createdAt: Date;
};

export interface ChatPeerDto {
	kind: ChatParticipantKind;
	id: string;
	role: string;
	name: string;
	avatarUrl: string;
}

export interface ChatMessageDto {
	id: string;
	conversationId: string;
	senderKind: ChatParticipantKind;
	senderId: string;
	senderRole: string;
	senderName: string;
	body: string;
	deleted: boolean;
	clientMessageId: string | null;
	createdAt: string;
}

export interface ChatConversationDto {
	id: string;
	type: string;
	peer: ChatPeerDto;
	lastMessage: {
		body: string;
		senderId: string | null;
		at: string | null;
		mine: boolean;
	} | null;
	unreadCount: number;
	/** When the other person last read the thread — drives "seen". */
	peerLastReadAt: string | null;
	canSend: boolean;
	/** Why sending is blocked, when it is. */
	blockedReason: ChatDenyReason | null;
	/** The viewer has blocked the other person (they can undo it). */
	blockedByMe: boolean;
	updatedAt: string;
}

const toMessageDto = (m: MessageLean): ChatMessageDto => ({
	id: String(m._id),
	conversationId: String(m.conversationId),
	senderKind: m.senderKind,
	senderId: String(m.senderId),
	senderRole: m.senderRole,
	senderName: m.senderName,
	body: m.deletedAt ? "" : m.body,
	deleted: Boolean(m.deletedAt),
	clientMessageId: m.clientMessageId ?? null,
	createdAt: new Date(m.createdAt).toISOString(),
});

const toPeerDto = (p: ParticipantLean | ChatPerson): ChatPeerDto => ({
	kind: p.kind,
	id: String(p.id),
	role: p.role,
	name: p.name,
	avatarUrl: p.avatarUrl,
});

const isMe = (p: ParticipantLean, me: ChatActor): boolean =>
	p.kind === me.kind && String(p.id) === me.id;

const splitParticipants = (
	conv: ConversationLean,
	me: ChatActor,
): { mine: ParticipantLean; peer: ParticipantLean } | null => {
	const mine = conv.participants.find((p) => isMe(p, me));
	const peer = conv.participants.find((p) => !isMe(p, me));
	return mine && peer ? { mine, peer } : null;
};

const actorOf = (p: ParticipantLean): ChatActor => ({
	kind: p.kind,
	id: String(p.id),
	role: (isChatRole(p.role) ? p.role : "client") as ChatRole,
});

const toConversationDto = async (
	conv: ConversationLean,
	me: ChatActor,
	ctx: PolicyContext,
): Promise<ChatConversationDto | null> => {
	const parts = splitParticipants(conv, me);
	if (!parts) return null;
	const peer = actorOf(parts.peer);
	const decision = await ctx.canSend(me, peer);
	return {
		id: String(conv._id),
		type: conv.type,
		peer: toPeerDto(parts.peer),
		lastMessage: conv.lastMessage?.at
			? {
					body: conv.lastMessage.body,
					senderId: conv.lastMessage.senderId
						? String(conv.lastMessage.senderId)
						: null,
					at: new Date(conv.lastMessage.at).toISOString(),
					mine: String(conv.lastMessage.senderId) === me.id,
				}
			: null,
		unreadCount: parts.mine.unreadCount ?? 0,
		peerLastReadAt: parts.peer.lastReadAt
			? new Date(parts.peer.lastReadAt).toISOString()
			: null,
		canSend: decision.allowed,
		blockedReason: decision.allowed ? null : (decision.reason ?? "NOT_ALLOWED"),
		blockedByMe: decision.reason === "BLOCKED_BY_YOU",
		updatedAt: new Date(conv.lastMessageAt ?? conv.updatedAt).toISOString(),
	};
};

const mineFilter = (me: ChatActor) => ({
	participants: { $elemMatch: { kind: me.kind, id: oid(me.id) } },
});

const loadConversation = async (
	me: ChatActor,
	conversationId: string,
): Promise<ConversationLean> => {
	if (!mongoose.Types.ObjectId.isValid(conversationId)) throw notFound();
	const conv = await ChatConversation.findOne({
		_id: conversationId,
		...mineFilter(me),
	}).lean<ConversationLean | null>();
	// A thread you are not in looks the same as one that does not exist.
	if (!conv) throw notFound();
	return conv;
};

const snapshot = (p: ChatPerson) => ({
	kind: p.kind,
	id: oid(p.id),
	role: p.role,
	name: p.name,
	avatarUrl: p.avatarUrl,
	unreadCount: 0,
	lastReadAt: null,
});

// ── Contacts ─────────────────────────────────────────────────────────────────

/** Everyone `me` is allowed to open a thread with. */
export const listContacts = async (
	me: ChatActor,
	options: { search?: string; limit?: number } = {},
): Promise<ChatPeerDto[]> => {
	const ctx = new PolicyContext();
	const flags = await ctx.override(me);
	if (me.role !== "admin" && flags.chatDisabled) return [];

	const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
	const groups = await Promise.all(
		CHAT_ROLES.map(async (role): Promise<ChatPerson[]> => {
			let mode = await ctx.mode(me.role, role);
			if (me.role !== "client" && me.role !== "admin") {
				if (role === "client" && flags.allClients) mode = "all";
				if (role !== "client" && role !== "admin" && flags.staffChat)
					mode = "all";
			}
			if (mode === "none") return [];
			if (mode === "all") {
				return listPeople(role, { search: options.search, limit });
			}
			// assigned
			let ids: string[];
			if (me.role === "client") {
				ids = (await getRelationship(role)?.staffIdsOf(me.id)) ?? [];
			} else {
				ids = Array.from(await ctx.clientIdsOf(me));
			}
			return listPeople(role, { search: options.search, ids, limit });
		}),
	);

	// The role rules narrowed the candidates; the full check has the last word
	// (blocks, chat turned off, lapsed memberships).
	const candidates = groups.flat();
	await ctx.prime([me, ...candidates]);
	const out: ChatPeerDto[] = [];
	for (const person of candidates) {
		if ((await ctx.canStart(me, person)).allowed) out.push(toPeerDto(person));
	}
	return out;
};

// ── Conversations ────────────────────────────────────────────────────────────

/** Find the thread with this person, or open one if the policy allows it. */
export const openConversation = async (
	me: ChatActor,
	target: { kind: ChatParticipantKind; id: string },
): Promise<ChatConversationDto> => {
	const [self, found] = await Promise.all([
		loadPerson(me.kind, me.id),
		loadPerson(target.kind, target.id),
	]);
	if (!self) throw new ChatError(401, "UNAUTHORIZED", "Account not found");
	// A trainer's shadow User record resolves to the trainer themself.
	const other =
		found?.kind === "User" && found.role === "client"
			? ((await trainerTwinOf(found.id)) ?? found)
			: found;
	if (!other?.active) throw denied("RECIPIENT_UNAVAILABLE");

	const directKey = [personKey(me), personKey(other)].sort().join("|");
	const ctx = new PolicyContext();

	let conv = await ChatConversation.findOne({
		directKey,
	}).lean<ConversationLean | null>();

	if (!conv) {
		const decision = await ctx.canStart(me, other);
		if (!decision.allowed) throw denied(decision.reason);
		try {
			const created = await ChatConversation.create({
				type: "direct",
				directKey,
				// The token's role is authoritative for the caller (a desk login has
				// no stored role of its own).
				participants: [snapshot({ ...self, role: me.role }), snapshot(other)],
			});
			conv = created.toObject() as unknown as ConversationLean;
		} catch (error) {
			// Both sides opened it at once — the unique index kept one.
			if ((error as { code?: number }).code !== 11000) throw error;
			conv = await ChatConversation.findOne({
				directKey,
			}).lean<ConversationLean | null>();
		}
	}
	if (!conv) throw notFound();

	const dto = await toConversationDto(conv, me, ctx);
	if (!dto) throw notFound();
	return dto;
};

export const listConversations = async (
	me: ChatActor,
): Promise<ChatConversationDto[]> => {
	const rows = await ChatConversation.find({
		...mineFilter(me),
		lastMessageAt: { $ne: null },
	})
		.sort({ lastMessageAt: -1 })
		.limit(200)
		.lean<ConversationLean[]>();

	const ctx = new PolicyContext();
	await ctx.prime([me, ...rows.flatMap((c) => c.participants.map(actorOf))]);
	const out: ChatConversationDto[] = [];
	for (const row of rows) {
		const dto = await toConversationDto(row, me, ctx);
		if (dto) out.push(dto);
	}
	return out;
};

export const getConversation = async (
	me: ChatActor,
	conversationId: string,
): Promise<ChatConversationDto> => {
	const conv = await loadConversation(me, conversationId);
	const dto = await toConversationDto(conv, me, new PolicyContext());
	if (!dto) throw notFound();
	return dto;
};

export const getUnreadCount = async (me: ChatActor): Promise<number> => {
	const [row] = await ChatConversation.aggregate<{ total: number }>([
		{ $match: mineFilter(me) },
		{ $unwind: "$participants" },
		{ $match: { "participants.kind": me.kind, "participants.id": oid(me.id) } },
		{ $group: { _id: null, total: { $sum: "$participants.unreadCount" } } },
	]);
	return row?.total ?? 0;
};

// ── Messages ─────────────────────────────────────────────────────────────────

const pageMessages = async (
	conversationId: mongoose.Types.ObjectId,
	options: { before?: string; limit?: number },
): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> => {
	const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
	const filter: Record<string, unknown> = { conversationId };
	if (options.before && mongoose.Types.ObjectId.isValid(options.before)) {
		filter._id = { $lt: oid(options.before) };
	}
	const rows = await ChatMessage.find(filter)
		.sort({ _id: -1 })
		.limit(limit + 1)
		.lean<MessageLean[]>();
	// Oldest first, ready to render.
	return {
		messages: rows.slice(0, limit).reverse().map(toMessageDto),
		hasMore: rows.length > limit,
	};
};

export const listMessages = async (
	me: ChatActor,
	conversationId: string,
	options: { before?: string; limit?: number } = {},
): Promise<{ messages: ChatMessageDto[]; hasMore: boolean }> => {
	const conv = await loadConversation(me, conversationId);
	return pageMessages(conv._id, options);
};

const preview = (body: string): string =>
	body.length > 140 ? `${body.slice(0, 137)}…` : body;

/** The User record that holds this person's browser push subscriptions. */
const pushUserIdOf = async (p: ParticipantLean): Promise<string | null> => {
	const id = String(p.id);
	if (p.kind === "User") return id;
	if (p.kind === "Trainer") return resolveTrainerUserId(id);
	// Admins have no push store of their own; like trainers, a User record under
	// the same email carries it when they have enabled notifications.
	const admin = await Admin.findById(id)
		.select("email")
		.lean<{ email?: string } | null>();
	if (!admin?.email) return null;
	const user = await User.findOne({ email: admin.email })
		.collation({ locale: "en", strength: 2 })
		.select("_id")
		.lean<{ _id: unknown } | null>();
	return user ? String(user._id) : null;
};

/** Push unless the recipient is looking at a live screen — then they see it land. */
const pushToRecipient = async (
	recipient: ParticipantLean,
	senderName: string,
	message: ChatMessageDto,
): Promise<void> => {
	if (isAttentive(String(recipient.id))) return;
	const title = senderName || "New message";
	const body = preview(message.body);
	const data = {
		kind: "chat_message",
		conversationId: message.conversationId,
		messageId: message.id,
	};
	const userId = await pushUserIdOf(recipient);
	if (!userId) return;
	await Promise.allSettled([
		// FCM reaches the member app; only member accounts register tokens.
		recipient.kind === "User"
			? sendPushToUser(userId, { title, body, data })
			: Promise.resolve(),
		sendWebPushToUser(userId, {
			title,
			body,
			url: `/admin/chat?c=${message.conversationId}`,
			tag: `chat:${message.conversationId}`,
			data,
		}),
	]);
};

export const sendMessage = async (
	me: ChatActor,
	conversationId: string,
	input: { body: string; clientMessageId?: string },
): Promise<ChatMessageDto> => {
	const body = input.body.trim();
	if (!body) throw badRequest("Message cannot be empty");
	if (body.length > CHAT_MESSAGE_MAX_LENGTH) {
		throw badRequest("Message is too long");
	}

	const conv = await loadConversation(me, conversationId);
	const parts = splitParticipants(conv, me);
	if (!parts) throw notFound();

	const findByClientId = () =>
		ChatMessage.findOne({
			conversationId: conv._id,
			senderId: me.id,
			clientMessageId: input.clientMessageId,
		}).lean<MessageLean | null>();

	if (input.clientMessageId) {
		const existing = await findByClientId();
		if (existing) return toMessageDto(existing);
	}

	const [self, other] = await Promise.all([
		loadPerson(me.kind, me.id),
		loadPerson(parts.peer.kind, String(parts.peer.id)),
	]);
	if (!self) throw new ChatError(401, "UNAUTHORIZED", "Account not found");
	if (!other?.active) throw denied("RECIPIENT_UNAVAILABLE");

	const decision = await new PolicyContext().canSend(me, other);
	if (!decision.allowed) throw denied(decision.reason);

	let created: MessageLean;
	try {
		const doc = await ChatMessage.create({
			conversationId: conv._id,
			senderKind: me.kind,
			senderId: me.id,
			senderRole: me.role,
			senderName: self.name,
			body,
			clientMessageId: input.clientMessageId,
		});
		created = doc.toObject() as unknown as MessageLean;
	} catch (error) {
		if ((error as { code?: number }).code !== 11000) throw error;
		const existing = await findByClientId();
		if (!existing) throw error;
		return toMessageDto(existing);
	}

	const at = created.createdAt;
	await ChatConversation.updateOne(
		{ _id: conv._id },
		{
			$set: {
				lastMessage: {
					id: created._id,
					body: preview(body),
					senderId: created.senderId,
					at,
				},
				lastMessageAt: at,
				// Sending implies you have read everything above. Names are
				// refreshed here so a rename shows up without a migration.
				"participants.$[me].unreadCount": 0,
				"participants.$[me].lastReadAt": at,
				"participants.$[me].name": self.name,
				"participants.$[me].avatarUrl": self.avatarUrl,
				"participants.$[peer].name": other.name,
				"participants.$[peer].avatarUrl": other.avatarUrl,
				"participants.$[peer].role": other.role,
			},
			$inc: { "participants.$[peer].unreadCount": 1 },
		},
		{
			arrayFilters: [
				{ "me.kind": me.kind, "me.id": oid(me.id) },
				{ "peer.kind": parts.peer.kind, "peer.id": parts.peer.id },
			],
		},
	);

	const dto = toMessageDto(created);
	const payload = { conversationId: dto.conversationId, message: dto };
	emitChatEvent(me.id, "chat:message", payload);
	emitChatEvent(String(parts.peer.id), "chat:message", payload);
	void pushToRecipient(parts.peer, self.name, dto).catch((err) =>
		console.error("[chat] push failed", err),
	);
	return dto;
};

/**
 * Mark the thread read.
 *
 * The unread counter is only zeroed if no message arrived while this was
 * running: the write is conditional on the thread's last message still being
 * the one we saw. If one slipped in, it is counted rather than silently marked
 * read.
 */
export const markRead = async (
	me: ChatActor,
	conversationId: string,
): Promise<{ readAt: string }> => {
	const conv = await loadConversation(me, conversationId);
	const parts = splitParticipants(conv, me);
	if (!parts) throw notFound();

	const readAt = new Date();
	const mineOnly = {
		arrayFilters: [{ "me.kind": me.kind, "me.id": oid(me.id) }],
	};
	const seenLastId = conv.lastMessage?.id ?? null;
	const result = await ChatConversation.updateOne(
		{ _id: conv._id, "lastMessage.id": seenLastId },
		{
			$set: {
				"participants.$[me].unreadCount": 0,
				"participants.$[me].lastReadAt": readAt,
			},
		},
		mineOnly,
	);
	if (result.matchedCount === 0) {
		// Something arrived mid-request. Whatever came after what we saw stays
		// unread; the client marks it read when it actually shows it.
		const unseen = await ChatMessage.countDocuments({
			conversationId: conv._id,
			senderId: parts.peer.id,
			...(seenLastId ? { _id: { $gt: seenLastId } } : {}),
		});
		await ChatConversation.updateOne(
			{ _id: conv._id },
			{
				$set: {
					"participants.$[me].unreadCount": unseen,
					"participants.$[me].lastReadAt": readAt,
				},
			},
			mineOnly,
		);
	}

	const payload = {
		conversationId: String(conv._id),
		readerId: me.id,
		readAt: readAt.toISOString(),
	};
	emitChatEvent(me.id, "chat:read", payload);
	emitChatEvent(String(parts.peer.id), "chat:read", payload);
	return { readAt: payload.readAt };
};

/** Wipe a message's text. The sender can remove their own; an admin, any. */
export const deleteMessage = async (
	me: ChatActor,
	messageId: string,
): Promise<{ conversationId: string; messageId: string }> => {
	if (!mongoose.Types.ObjectId.isValid(messageId)) throw notFound("Message");
	const message = await ChatMessage.findById(
		messageId,
	).lean<MessageLean | null>();
	if (!message) throw notFound("Message");

	const isSender =
		message.senderKind === me.kind && String(message.senderId) === me.id;
	// Someone outside the thread learns nothing, not even that it exists.
	if (!isSender && me.role !== "admin") throw notFound("Message");

	const conversationId = String(message.conversationId);
	if (!message.deletedAt) {
		await ChatMessage.updateOne(
			{ _id: message._id },
			{ $set: { body: "", deletedAt: new Date(), deletedBy: me.id } },
		);
		// Keep the inbox preview from showing text that no longer exists.
		await ChatConversation.updateOne(
			{ _id: message.conversationId, "lastMessage.id": message._id },
			{ $set: { "lastMessage.body": DELETED_PREVIEW } },
		);
	}

	const conv = await ChatConversation.findById(
		message.conversationId,
	).lean<ConversationLean | null>();
	const payload = { conversationId, messageId: String(message._id) };
	for (const p of conv?.participants ?? []) {
		emitChatEvent(String(p.id), "chat:message_deleted", payload);
	}
	return payload;
};

// ── Blocking ─────────────────────────────────────────────────────────────────

export const blockPerson = async (
	me: ChatActor,
	target: { kind: ChatParticipantKind; id: string },
): Promise<ChatPeerDto> => {
	if (me.role === "admin") throw badRequest("Admins cannot block people");
	const person = await loadPerson(target.kind, target.id);
	if (!person) throw notFound("Person");
	if (personKey(person) === personKey(me)) {
		throw badRequest("You cannot block yourself");
	}
	if (person.role === "admin") throw badRequest("Admins cannot be blocked");
	await ChatBlock.updateOne(
		{ blockerId: me.id, blockedId: person.id },
		{ $setOnInsert: { blockerKind: me.kind, blockedKind: person.kind } },
		{ upsert: true },
	);
	return toPeerDto(person);
};

export const unblockPerson = async (
	me: ChatActor,
	target: { kind: ChatParticipantKind; id: string },
): Promise<void> => {
	if (!mongoose.Types.ObjectId.isValid(target.id)) return;
	await ChatBlock.deleteOne({ blockerId: me.id, blockedId: target.id });
};

export const listBlocked = async (me: ChatActor): Promise<ChatPeerDto[]> => {
	const rows = await ChatBlock.find({ blockerId: me.id })
		.sort({ createdAt: -1 })
		.lean<Array<{ blockedKind: ChatParticipantKind; blockedId: unknown }>>();
	const people = await Promise.all(
		rows.map((r) => loadPerson(r.blockedKind, String(r.blockedId))),
	);
	return people.filter((p): p is ChatPerson => p !== null).map(toPeerDto);
};

// ── Reports ──────────────────────────────────────────────────────────────────

export interface ChatReportDto {
	id: string;
	conversationId: string;
	messageId: string | null;
	messageBody: string;
	reporter: { kind: string; id: string; name: string };
	reported: { kind: string; id: string; name: string };
	reason: string;
	note: string;
	status: string;
	resolutionNote: string;
	createdAt: string;
	resolvedAt: string | null;
}

type ReportLean = {
	_id: mongoose.Types.ObjectId;
	conversationId: mongoose.Types.ObjectId;
	messageId: mongoose.Types.ObjectId | null;
	messageBody: string;
	reporterKind: string;
	reporterId: mongoose.Types.ObjectId;
	reporterName: string;
	reportedKind: string;
	reportedId: mongoose.Types.ObjectId;
	reportedName: string;
	reason: string;
	note: string;
	status: string;
	resolutionNote: string;
	createdAt: Date;
	resolvedAt: Date | null;
};

const toReportDto = (r: ReportLean): ChatReportDto => ({
	id: String(r._id),
	conversationId: String(r.conversationId),
	messageId: r.messageId ? String(r.messageId) : null,
	messageBody: r.messageBody,
	reporter: {
		kind: r.reporterKind,
		id: String(r.reporterId),
		name: r.reporterName,
	},
	reported: {
		kind: r.reportedKind,
		id: String(r.reportedId),
		name: r.reportedName,
	},
	reason: r.reason,
	note: r.note,
	status: r.status,
	resolutionNote: r.resolutionNote,
	createdAt: new Date(r.createdAt).toISOString(),
	resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
});

/** Flag a conversation (or one message the other person sent) for an admin. */
export const reportConversation = async (
	me: ChatActor,
	conversationId: string,
	input: { reason: ChatReportReason; note?: string; messageId?: string },
): Promise<ChatReportDto> => {
	const conv = await loadConversation(me, conversationId);
	const parts = splitParticipants(conv, me);
	if (!parts) throw notFound();

	let message: MessageLean | null = null;
	if (input.messageId) {
		if (!mongoose.Types.ObjectId.isValid(input.messageId)) {
			throw notFound("Message");
		}
		message = await ChatMessage.findOne({
			_id: input.messageId,
			conversationId: conv._id,
		}).lean<MessageLean | null>();
		if (!message) throw notFound("Message");
	}

	const created = await ChatReport.create({
		conversationId: conv._id,
		messageId: message?._id ?? null,
		messageBody: message?.body ?? "",
		reporterKind: me.kind,
		reporterId: me.id,
		reporterName: parts.mine.name,
		reportedKind: parts.peer.kind,
		reportedId: parts.peer.id,
		reportedName: parts.peer.name,
		reason: input.reason,
		note: input.note?.trim() ?? "",
	});
	return toReportDto(created.toObject() as unknown as ReportLean);
};

export const listReports = async (
	status?: "open" | "resolved",
): Promise<ChatReportDto[]> => {
	const rows = await ChatReport.find(status ? { status } : {})
		.sort({ createdAt: -1 })
		.limit(200)
		.lean<ReportLean[]>();
	return rows.map(toReportDto);
};

export const countOpenReports = (): Promise<number> =>
	ChatReport.countDocuments({ status: "open" });

export const resolveReport = async (
	admin: ChatActor,
	reportId: string,
	input: { status: "open" | "resolved"; resolutionNote?: string },
): Promise<ChatReportDto> => {
	if (!mongoose.Types.ObjectId.isValid(reportId)) throw notFound("Report");
	const resolved = input.status === "resolved";
	const updated = await ChatReport.findByIdAndUpdate(
		reportId,
		{
			$set: {
				status: input.status,
				resolvedBy: resolved ? admin.id : null,
				resolvedAt: resolved ? new Date() : null,
				...(input.resolutionNote !== undefined
					? { resolutionNote: input.resolutionNote.trim() }
					: {}),
			},
		},
		{ returnDocument: "after" },
	).lean<ReportLean | null>();
	if (!updated) throw notFound("Report");
	return toReportDto(updated);
};

// ── Admin oversight ──────────────────────────────────────────────────────────

export interface ChatAdminConversationDto {
	id: string;
	participants: ChatPeerDto[];
	lastMessage: { body: string; at: string | null } | null;
	updatedAt: string;
}

const escapeRegex = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toAdminConversationDto = (
	c: ConversationLean,
): ChatAdminConversationDto => ({
	id: String(c._id),
	participants: c.participants.map(toPeerDto),
	lastMessage: c.lastMessage?.at
		? {
				body: c.lastMessage.body,
				at: new Date(c.lastMessage.at).toISOString(),
			}
		: null,
	updatedAt: new Date(c.lastMessageAt ?? c.updatedAt).toISOString(),
});

/** Every conversation, for an admin reviewing a report or a complaint. */
export const adminListConversations = async (
	options: { search?: string; limit?: number } = {},
): Promise<ChatAdminConversationDto[]> => {
	const filter: Record<string, unknown> = { lastMessageAt: { $ne: null } };
	const search = options.search?.trim();
	if (search) {
		filter["participants.name"] = new RegExp(escapeRegex(search), "i");
	}
	const rows = await ChatConversation.find(filter)
		.sort({ lastMessageAt: -1 })
		.limit(Math.min(Math.max(options.limit ?? 50, 1), 200))
		.lean<ConversationLean[]>();
	return rows.map(toAdminConversationDto);
};

export const adminGetConversation = async (
	conversationId: string,
	options: { before?: string; limit?: number } = {},
): Promise<{
	conversation: ChatAdminConversationDto;
	messages: ChatMessageDto[];
	hasMore: boolean;
}> => {
	if (!mongoose.Types.ObjectId.isValid(conversationId)) throw notFound();
	const conv = await ChatConversation.findById(
		conversationId,
	).lean<ConversationLean | null>();
	if (!conv) throw notFound();
	return {
		conversation: toAdminConversationDto(conv),
		...(await pageMessages(conv._id, options)),
	};
};

// ── Account deletion ─────────────────────────────────────────────────────────

/**
 * Remove everything chat holds about a member whose account is being deleted:
 * their threads (both sides of them — a conversation is personal data of the
 * person leaving), blocks, reports they filed and any per-person toggle.
 */
export const purgeChatDataForUser = async (
	userId: string | mongoose.Types.ObjectId,
): Promise<{ conversations: number; messages: number }> => {
	const id = typeof userId === "string" ? oid(userId) : userId;
	const conversationIds = (await ChatConversation.distinct("_id", {
		participants: { $elemMatch: { kind: "User", id } },
	})) as mongoose.Types.ObjectId[];
	const [messages] = await Promise.all([
		ChatMessage.deleteMany({ conversationId: { $in: conversationIds } }),
		ChatReport.deleteMany({
			$or: [{ conversationId: { $in: conversationIds } }, { reporterId: id }],
		}),
		ChatBlock.deleteMany({ $or: [{ blockerId: id }, { blockedId: id }] }),
		ChatOverride.deleteMany({ kind: "User", personId: id }),
	]);
	await ChatConversation.deleteMany({ _id: { $in: conversationIds } });
	return {
		conversations: conversationIds.length,
		messages: messages.deletedCount ?? 0,
	};
};
