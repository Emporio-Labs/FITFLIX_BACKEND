/**
 * Chat: who may talk to whom, and the message flow on top of it.
 *
 * Needs a throwaway MongoDB and refuses anything that isn't local:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/chattest bun run test:chat
 */
import mongoose from "mongoose";
import {
	adminGetConversation,
	adminListConversations,
	blockPerson,
	ChatError,
	deleteMessage,
	getUnreadCount,
	listReports,
	purgeChatDataForUser,
	reportConversation,
	resolveReport,
	unblockPerson,
	listContacts,
	listConversations,
	listMessages,
	markRead,
	openConversation,
	sendMessage,
} from "../src/services/chat/chat.service";
import type { ChatActor } from "../src/services/chat/people";
import {
	getPolicyMatrix,
	resetPolicy,
	updateChatSettings,
	updatePolicy,
} from "../src/services/chat/policy";
import { MembershipStatus } from "../src/models/Enums";
import { ChatOverride } from "../src/models/ChatPolicy";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error("TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.");
	process.exit(1);
}

let failed = 0;
function check(name: string, cond: boolean) {
	if (!cond) failed++;
	console.log(`  ${cond ? "✅" : "❌ FAILED:"} ${name}`);
}

const oid = () => new mongoose.Types.ObjectId();

/** Resolves to the deny reason, or null when the call went through. */
async function reasonOf(fn: () => Promise<unknown>): Promise<string | null> {
	try {
		await fn();
		return null;
	} catch (error) {
		if (error instanceof ChatError) return error.reason ?? error.code;
		throw error;
	}
}

const ids = {
	admin: oid(),
	trainerA: oid(),
	trainerB: oid(),
	nutritionist: oid(),
	clientA: oid(), // assigned to trainerA
	clientB: oid(), // assigned to nobody
	clientC: oid(), // booked with nutritionist
	clientD: oid(), // assigned to trainerA, membership lapsed
	trainerBShadow: oid(), // trainer B's User record (same email)
};

const actor = (kind: ChatActor["kind"], id: mongoose.Types.ObjectId, role: ChatActor["role"]): ChatActor => ({
	kind,
	id: String(id),
	role,
});

const admin = actor("Admin", ids.admin, "admin");
const trainerA = actor("Trainer", ids.trainerA, "trainer");
const trainerB = actor("Trainer", ids.trainerB, "trainer");
const nutritionist = actor("User", ids.nutritionist, "nutritionist");
const clientA = actor("User", ids.clientA, "client");
const clientB = actor("User", ids.clientB, "client");
const clientC = actor("User", ids.clientC, "client");

const clientD = actor("User", ids.clientD, "client");

const target = (a: ChatActor) => ({ kind: a.kind, id: a.id });

async function main() {
	await mongoose.connect(url);
	const db = mongoose.connection.db;
	if (!db) throw new Error("not connected");
	await db.dropDatabase();

	await db.collection("admins").insertOne({ _id: ids.admin, adminName: "Asha Admin", email: "admin@test" });
	await db.collection("trainers").insertMany([
		{ _id: ids.trainerA, trainerName: "Trainer A", email: "ta@test", isActive: true },
		{ _id: ids.trainerB, trainerName: "Trainer B", email: "tb@test", isActive: true },
	]);
	await db.collection("users").insertMany([
		{ _id: ids.nutritionist, username: "Nina Nutrition", email: "n@test", staffRole: "nutritionist", isActive: true },
		{ _id: ids.clientA, username: "Client A", email: "ca@test", isActive: true, assignedTrainer: ids.trainerA },
		{ _id: ids.clientB, username: "Client B", email: "cb@test", isActive: true },
		{ _id: ids.clientC, username: "Client C", email: "cc@test", isActive: true },
	]);
	await db.collection("users").insertMany([
		{ _id: ids.clientD, username: "Client D", email: "cd@test", isActive: true, assignedTrainer: ids.trainerA },
		{ _id: ids.trainerBShadow, username: "Trainer B", email: "TB@test", isActive: true },
	]);
	const yearAgo = new Date(Date.now() - 365 * 86400_000);
	const nextYear = new Date(Date.now() + 365 * 86400_000);
	const lastMonth = new Date(Date.now() - 30 * 86400_000);
	await db.collection("memberships").insertMany([
		...[ids.clientA, ids.clientB, ids.clientC].map((user) => ({
			user,
			status: MembershipStatus.Active,
			startDate: yearAgo,
			endDate: nextYear,
		})),
		{ user: ids.clientD, status: MembershipStatus.Active, startDate: yearAgo, endDate: lastMonth },
	]);
	await db.collection("nutritionistbookings").insertOne({
		userId: ids.clientC,
		assignedNutritionistId: ids.nutritionist,
	});

	console.log("\n── Default rules ──");
	check("member → own trainer: allowed", (await reasonOf(() => openConversation(clientA, target(trainerA)))) === null);
	check("trainer → own member: allowed", (await reasonOf(() => openConversation(trainerA, target(clientA)))) === null);
	check("member → another trainer: NOT_ASSIGNED", (await reasonOf(() => openConversation(clientA, target(trainerB)))) === "NOT_ASSIGNED");
	check("trainer → someone else's member: NOT_ASSIGNED", (await reasonOf(() => openConversation(trainerB, target(clientA)))) === "NOT_ASSIGNED");
	check("member → member: NOT_ALLOWED", (await reasonOf(() => openConversation(clientA, target(clientB)))) === "NOT_ALLOWED");
	check("trainer → trainer: NOT_ALLOWED", (await reasonOf(() => openConversation(trainerA, target(trainerB)))) === "NOT_ALLOWED");
	check("trainer → nutritionist: NOT_ALLOWED", (await reasonOf(() => openConversation(trainerA, target(nutritionist)))) === "NOT_ALLOWED");
	check("member → booked nutritionist: allowed", (await reasonOf(() => openConversation(clientC, target(nutritionist)))) === null);
	check("member → unrelated nutritionist: NOT_ASSIGNED", (await reasonOf(() => openConversation(clientA, target(nutritionist)))) === "NOT_ASSIGNED");
	check("member → admin: NOT_ALLOWED", (await reasonOf(() => openConversation(clientB, target(admin)))) === "NOT_ALLOWED");
	check("trainer → admin: allowed", (await reasonOf(() => openConversation(trainerA, target(admin)))) === null);
	check("admin → member: allowed", (await reasonOf(() => openConversation(admin, target(clientB)))) === null);
	check("admin → trainer: allowed", (await reasonOf(() => openConversation(admin, target(trainerB)))) === null);
	check("self: SELF", (await reasonOf(() => openConversation(clientA, target(clientA)))) === "SELF");

	console.log("\n── Contacts ──");
	const names = async (a: ChatActor) => (await listContacts(a)).map((c) => c.name).sort();
	check("member A sees only their trainer", JSON.stringify(await names(clientA)) === JSON.stringify(["Trainer A"]));
	check("member C sees only their nutritionist", JSON.stringify(await names(clientC)) === JSON.stringify(["Nina Nutrition"]));
	check("member B sees nobody", (await names(clientB)).length === 0);
	check("trainer A sees their member and the admin", JSON.stringify(await names(trainerA)) === JSON.stringify(["Asha Admin", "Client A"]));
	check("admin sees everyone else, each person once", (await names(admin)).length === 7);
	check("a trainer's shadow member record is not listed twice", (await names(admin)).filter((n) => n === "Trainer B").length === 1);

	console.log("\n── Messaging ──");
	const conv = await openConversation(clientA, target(trainerA));
	const again = await openConversation(trainerA, target(clientA));
	check("both sides resolve to the same thread", conv.id === again.id);
	check("an empty thread is not in the inbox", (await listConversations(trainerA)).length === 0);

	const m1 = await sendMessage(clientA, conv.id, { body: "  Hi coach  ", clientMessageId: "c-1" });
	check("message body is trimmed", m1.body === "Hi coach");
	const retry = await sendMessage(clientA, conv.id, { body: "Hi coach", clientMessageId: "c-1" });
	check("a retried send does not duplicate", retry.id === m1.id);
	await sendMessage(clientA, conv.id, { body: "Can we move tomorrow's session?" });

	check("recipient unread count is 2", (await getUnreadCount(trainerA)) === 2);
	check("sender unread count is 0", (await getUnreadCount(clientA)) === 0);
	const inbox = await listConversations(trainerA);
	check("thread shows in the trainer's inbox", inbox.length === 1 && inbox[0]?.peer.name === "Client A");
	check("inbox carries last message + unread", inbox[0]?.unreadCount === 2 && inbox[0]?.lastMessage?.body === "Can we move tomorrow's session?");

	await markRead(trainerA, conv.id);
	check("mark read clears unread", (await getUnreadCount(trainerA)) === 0);
	await sendMessage(trainerA, conv.id, { body: "Sure, 7am works" });
	const page = await listMessages(clientA, conv.id, { limit: 2 });
	check("messages page newest-last with hasMore", page.messages.length === 2 && page.hasMore && page.messages[1]?.body === "Sure, 7am works");
	const older = await listMessages(clientA, conv.id, { before: page.messages[0]?.id });
	check("`before` pages back", older.messages.length === 1 && older.messages[0]?.body === "Hi coach");

	check("outsider cannot read the thread", (await reasonOf(() => listMessages(trainerB, conv.id))) === "NOT_FOUND");
	check("outsider cannot send into the thread", (await reasonOf(() => sendMessage(clientB, conv.id, { body: "x" }))) === "NOT_FOUND");

	console.log("\n── Replies without the right to start ──");
	const adminThread = await openConversation(admin, target(clientB));
	await sendMessage(admin, adminThread.id, { body: "Welcome to Fitflix" });
	check("member can reply to an admin", (await reasonOf(() => sendMessage(clientB, adminThread.id, { body: "Thanks!" }))) === null);

	console.log("\n── Per-person toggles ──");
	await ChatOverride.create({ kind: "Trainer", personId: ids.trainerA, staffChat: true });
	check("staffChat: trainer A can start with trainer B", (await reasonOf(() => openConversation(trainerA, target(trainerB)))) === null);
	check("…and with the nutritionist", (await reasonOf(() => openConversation(trainerA, target(nutritionist)))) === null);
	const staffThread = await openConversation(trainerA, target(trainerB));
	await sendMessage(trainerA, staffThread.id, { body: "Cover my 6pm?" });
	check("trainer B can reply", (await reasonOf(() => sendMessage(trainerB, staffThread.id, { body: "Yes" }))) === null);
	check("trainer B still cannot start with the nutritionist", (await reasonOf(() => openConversation(trainerB, target(nutritionist)))) === "NOT_ALLOWED");

	await ChatOverride.updateOne({ kind: "Trainer", personId: ids.trainerA }, { $set: { staffChat: false } });
	check("toggle off: the thread becomes read-only", (await reasonOf(() => sendMessage(trainerB, staffThread.id, { body: "?" }))) === "NOT_ALLOWED");
	const readonly = (await listConversations(trainerB)).find((c) => c.id === staffThread.id);
	check("inbox reports canSend=false", readonly?.canSend === false && readonly.blockedReason === "NOT_ALLOWED");
	check("history stays readable", (await listMessages(trainerB, staffThread.id)).messages.length === 2);

	await ChatOverride.updateOne({ kind: "Trainer", personId: ids.trainerB }, { $set: { allClients: true } }, { upsert: true });
	check("allClients: trainer B can start with any member", (await reasonOf(() => openConversation(trainerB, target(clientA)))) === null);

	await ChatOverride.updateOne({ kind: "User", personId: ids.clientA }, { $set: { chatDisabled: true } }, { upsert: true });
	check("chatDisabled: the member cannot send", (await reasonOf(() => sendMessage(clientA, conv.id, { body: "x" }))) === "CHAT_DISABLED");
	check("chatDisabled: nobody can send to them", (await reasonOf(() => sendMessage(trainerA, conv.id, { body: "x" }))) === "RECIPIENT_UNAVAILABLE");
	check("chatDisabled: hidden from contacts", !(await names(trainerA)).includes("Client A"));
	await ChatOverride.deleteMany({});

	console.log("\n── Admin-edited rules ──");
	await updatePolicy([{ from: "trainer", to: "trainer", mode: "all" }], admin.id);
	check("trainer↔trainer switched on", (await reasonOf(() => openConversation(trainerB, target(trainerA)))) === null);
	check("other staff pairs unaffected", (await reasonOf(() => openConversation(trainerB, target(nutritionist)))) === "NOT_ALLOWED");
	await updatePolicy([{ from: "client", to: "trainer", mode: "none" }, { from: "trainer", to: "client", mode: "none" }], admin.id);
	check("member↔trainer switched off blocks the existing thread", (await reasonOf(() => sendMessage(clientA, conv.id, { body: "x" }))) === "NOT_ALLOWED");
	check("admin row cannot be edited", (await reasonOf(async () => {
		try { await updatePolicy([{ from: "admin", to: "client", mode: "none" }], admin.id); }
		catch { throw new ChatError(400, "BAD_REQUEST", "locked"); }
	})) === "BAD_REQUEST");
	check("`assigned` rejected where no relationship exists", (await reasonOf(async () => {
		try { await updatePolicy([{ from: "trainer", to: "trainer", mode: "assigned" }], admin.id); }
		catch { throw new ChatError(400, "BAD_REQUEST", "unsupported"); }
	})) === "BAD_REQUEST");
	const matrix = await resetPolicy(admin.id);
	check("reset restores defaults", matrix.every((r) => r.mode === r.defaultMode));
	check("matrix covers every role pair", (await getPolicyMatrix()).length === 49);

	console.log("\n── Lapsed membership ──");
	check("lapsed member cannot start with their trainer", (await reasonOf(() => openConversation(clientD, target(trainerA)))) === "MEMBERSHIP_INACTIVE");
	check("trainer cannot start with a lapsed member", (await reasonOf(() => openConversation(trainerA, target(clientD)))) === "RECIPIENT_UNAVAILABLE");
	check("lapsed member sees no contacts", (await names(clientD)).length === 0);
	const renewal = await openConversation(admin, target(clientD));
	await sendMessage(admin, renewal.id, { body: "Your plan ended — want to renew?" });
	check("lapsed member can still answer an admin", (await reasonOf(() => sendMessage(clientD, renewal.id, { body: "Yes please" }))) === null);
	await updateChatSettings({ requireActiveMembership: false }, admin.id);
	check("rule switched off: lapsed member reaches their trainer", (await reasonOf(() => openConversation(clientD, target(trainerA)))) === null);
	await updateChatSettings({ requireActiveMembership: true }, admin.id);
	check("rule back on: that thread is read-only", (await reasonOf(async () => {
		const c = await openConversation(clientD, target(trainerA));
		await sendMessage(clientD, c.id, { body: "x" });
	})) === "MEMBERSHIP_INACTIVE");

	console.log("\n── Blocking ──");
	await blockPerson(clientA, target(trainerA));
	check("the blocker cannot send (and is told why)", (await reasonOf(() => sendMessage(clientA, conv.id, { body: "x" }))) === "BLOCKED_BY_YOU");
	check("the blocked person cannot send", (await reasonOf(() => sendMessage(trainerA, conv.id, { body: "x" }))) === "BLOCKED");
	check("blocked person no longer sees the blocker in contacts", !(await names(trainerA)).includes("Client A"));
	const blockedView = (await listConversations(clientA)).find((c) => c.id === conv.id);
	check("inbox flags blockedByMe for the blocker only", blockedView?.blockedByMe === true && (await listConversations(trainerA)).find((c) => c.id === conv.id)?.blockedByMe === false);
	check("admins cannot be blocked", (await reasonOf(() => blockPerson(clientA, target(admin)))) === "BAD_REQUEST");
	await unblockPerson(clientA, target(trainerA));
	check("unblocking restores the thread", (await reasonOf(() => sendMessage(trainerA, conv.id, { body: "Back on" }))) === null);

	console.log("\n── Deleting a message ──");
	const doomed = await sendMessage(clientA, conv.id, { body: "wrong chat, sorry" });
	check("the other person cannot delete it", (await reasonOf(() => deleteMessage(trainerA, doomed.id))) === "NOT_FOUND");
	await deleteMessage(clientA, doomed.id);
	const afterDelete = (await listMessages(trainerA, conv.id)).messages.find((m) => m.id === doomed.id);
	check("deleted message keeps its place with no text", afterDelete?.deleted === true && afterDelete.body === "");
	check("inbox preview no longer shows the text", (await listConversations(trainerA)).find((c) => c.id === conv.id)?.lastMessage?.body === "Message deleted");
	const rude = await sendMessage(trainerA, conv.id, { body: "something rude" });

	console.log("\n── Reports and admin oversight ──");
	await reportConversation(clientA, conv.id, { reason: "harassment", note: "not ok", messageId: rude.id });
	check("an outsider cannot report a thread they are not in", (await reasonOf(() => reportConversation(clientB, conv.id, { reason: "spam" }))) === "NOT_FOUND");
	const open = await listReports("open");
	check("the report reaches admins with the message text", open.length === 1 && open[0]?.messageBody === "something rude" && open[0]?.reported.name === "Trainer A");
	await deleteMessage(admin, rude.id);
	check("an admin can remove any message", (await listMessages(clientA, conv.id)).messages.find((m) => m.id === rude.id)?.deleted === true);
	check("the report still holds the removed text", (await listReports("open"))[0]?.messageBody === "something rude");
	const firstReport = open[0];
	if (firstReport) await resolveReport(admin, firstReport.id, { status: "resolved", resolutionNote: "Spoke to the trainer" });
	check("resolving clears the open queue", (await listReports("open")).length === 0 && (await listReports("resolved")).length === 1);
	const everything = await adminListConversations({ search: "Client A" });
	check("admin can find any conversation", everything.some((c) => c.id === conv.id));
	check("admin can read a conversation they are not in", (await adminGetConversation(conv.id)).messages.length > 0);

	console.log("\n── Read receipts ──");
	await markRead(clientA, conv.id);
	await sendMessage(trainerA, conv.id, { body: "one" });
	await sendMessage(trainerA, conv.id, { body: "two" });
	check("two unread before reading", (await listConversations(clientA)).find((c) => c.id === conv.id)?.unreadCount === 2);
	await markRead(clientA, conv.id);
	check("reading clears them", (await listConversations(clientA)).find((c) => c.id === conv.id)?.unreadCount === 0);

	console.log("\n── One person, one identity ──");
	const viaShadow = await openConversation(admin, { kind: "User", id: String(ids.trainerBShadow) });
	check("messaging a trainer's member record lands on the trainer", viaShadow.peer.kind === "Trainer" && viaShadow.peer.id === trainerB.id);

	console.log("\n── Account deletion ──");
	const nutritionThread = await openConversation(clientC, target(nutritionist));
	await sendMessage(clientC, nutritionThread.id, { body: "Meal plan question" });
	const purged = await purgeChatDataForUser(clientC.id);
	check("the member's conversations and messages are removed", purged.conversations === 1 && purged.messages === 1);
	check("gone from the other person's inbox too", !(await listConversations(nutritionist)).some((c) => c.id === nutritionThread.id));
	check("other people's conversations are untouched", (await listMessages(clientA, conv.id)).messages.length > 0);

	await db.dropDatabase();
	await mongoose.disconnect();
	console.log(failed === 0 ? "\nAll chat checks passed." : `\n${failed} check(s) FAILED.`);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
