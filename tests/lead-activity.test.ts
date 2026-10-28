import mongoose from "mongoose";
import { LeadStatus } from "../src/models/Enums";
import Lead from "../src/models/Lead";
import LeadActivity from "../src/models/LeadActivity";
import Trainer from "../src/models/Trainer";
import { applyLeadOutcome, LeadOutcomeError } from "../src/utils/lead-outcomes";
import {
	adminToken,
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

const stamp = String(Date.now()).slice(-6);
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

const throwsCode = (fn: () => unknown, code: string) => {
	try {
		fn();
		return false;
	} catch (e) {
		return e instanceof LeadOutcomeError && e.code === code;
	}
};

function ruleTests() {
	console.log("\n🔎 Outcome rules (no database)");
	const fresh = { status: LeadStatus.New };
	const later = new Date(Date.now() + 3600_000);

	assert(
		throwsCode(() => applyLeadOutcome(fresh, { channel: "call", outcome: "no_answer" }), "FOLLOW_UP_REQUIRED"),
		"No answer needs a next follow-up",
	);
	const na = applyLeadOutcome(fresh, { channel: "call", outcome: "no_answer", nextFollowUpAt: later });
	assert(na.statusTo === LeadStatus.New, "No answer keeps a New lead New");
	assert(na.set.noAnswerStreak === 1 && !na.connected, "No answer counts toward the streak");

	const third = applyLeadOutcome(
		{ status: LeadStatus.New, noAnswerStreak: 2, temperature: "warm" },
		{ channel: "call", outcome: "no_answer", nextFollowUpAt: later },
	);
	assert(third.set.temperature === "cold", "Third no-answer in a row turns the lead Cold");

	const sixth = applyLeadOutcome(
		{ status: LeadStatus.New, noAnswerStreak: 5, firstAttemptAt: new Date(Date.now() - 8 * 86400_000) },
		{ channel: "call", outcome: "switched_off", nextFollowUpAt: later },
	);
	assert(sixth.suggestLost, "6 unanswered tries over 7+ days suggests Lost");
	const sixthFast = applyLeadOutcome(
		{ status: LeadStatus.New, noAnswerStreak: 5, firstAttemptAt: new Date(Date.now() - 2 * 86400_000) },
		{ channel: "call", outcome: "switched_off", nextFollowUpAt: later },
	);
	assert(!sixthFast.suggestLost, "…but not when the tries were within a week");

	const spoke = applyLeadOutcome(
		{ status: LeadStatus.New, noAnswerStreak: 4 },
		{ channel: "call", outcome: "call_back_later", nextFollowUpAt: later },
	);
	assert(spoke.statusTo === LeadStatus.Contacted, "Speaking to them moves New → Contacted");
	assert(spoke.set.noAnswerStreak === 0 && Boolean(spoke.set.firstContactedAt), "Connecting resets the streak and stamps first contact");

	const keep = applyLeadOutcome(
		{ status: LeadStatus.VisitBooked, visitAt: later },
		{ channel: "call", outcome: "call_back_later", nextFollowUpAt: later },
	);
	assert(keep.statusTo === LeadStatus.VisitBooked, "A call-back never moves a lead backwards");

	assert(
		throwsCode(() => applyLeadOutcome(fresh, { channel: "call", outcome: "visit_booked" }), "VISIT_AT_REQUIRED"),
		"Booking a visit needs the visit time",
	);
	const booked = applyLeadOutcome(fresh, { channel: "call", outcome: "visit_booked", visitAt: later });
	assert(
		booked.statusTo === LeadStatus.VisitBooked && booked.set.followUpDate === later,
		"Visit booked → Visit booked column, follow-up = visit time",
	);

	assert(
		throwsCode(() => applyLeadOutcome(fresh, { channel: "call", outcome: "not_interested" }), "LOST_REASON_REQUIRED"),
		"Not interested needs a reason",
	);
	const lost = applyLeadOutcome(fresh, {
		channel: "call",
		outcome: "not_interested",
		lostReason: "other",
		lostReasonText: "Moving cities",
	});
	assert(lost.statusTo === LeadStatus.Lost && lost.lostReason === "other: Moving cities", "Lost with a custom reason");
	assert(lost.set.followUpDate === null, "Lost clears the follow-up");

	const wrong = applyLeadOutcome(fresh, { channel: "call", outcome: "wrong_number" });
	assert(wrong.statusTo === LeadStatus.Lost && wrong.lostReason === "invalid_number", "Wrong number closes as invalid");

	const noShow = applyLeadOutcome(
		{ status: LeadStatus.VisitBooked, temperature: "hot" },
		{ channel: "visit", outcome: "no_show", nextFollowUpAt: later },
	);
	assert(
		noShow.statusTo === LeadStatus.Contacted && noShow.set.temperature === "warm",
		"No-show goes back to Contacted and cools down",
	);

	assert(
		throwsCode(() => applyLeadOutcome(fresh, { channel: "call", outcome: "custom", nextFollowUpAt: later }), "CUSTOM_LABEL_REQUIRED"),
		"Custom outcome needs a description",
	);
	const custom = applyLeadOutcome(
		{ status: LeadStatus.Contacted },
		{ channel: "whatsapp", outcome: "custom", customLabel: "Sent gym tour video", customStatus: LeadStatus.Qualified, nextFollowUpAt: later },
	);
	assert(custom.label === "Sent gym tour video" && custom.statusTo === LeadStatus.Qualified, "Custom outcome uses its own words and status");

	const reopened = applyLeadOutcome(
		{ status: LeadStatus.Lost },
		{ channel: "call", outcome: "interested_deciding", nextFollowUpAt: later },
	);
	assert(reopened.statusTo === LeadStatus.Contacted, "Talking to a Lost lead reopens it");

	assert(
		throwsCode(() => applyLeadOutcome({ status: LeadStatus.Converted }, { channel: "call", outcome: "not_interested", lostReason: "price" }), "LEAD_CONVERTED"),
		"A member can't be marked Lost",
	);
	assert(
		throwsCode(() => applyLeadOutcome(fresh, { channel: "visit", outcome: "no_answer", nextFollowUpAt: later }), "OUTCOME_CHANNEL_MISMATCH"),
		"Outcome must fit the channel",
	);
}

async function apiTests() {
	const { baseUrl, close } = await startTestServer();
	try {
		const adminId = "507f1f77bcf86cd799439011";

		console.log("\n🔎 Logging outcomes through the API");
		const created = await fetchJson(baseUrl, "/leads", {
			method: "POST",
			token: adminToken,
			body: { leadName: "Timeline Lead", phone: `97${stamp}01`, source: "instagram" },
		});
		assert(created.status === 201, "Lead created");
		const leadId = String(created.data.lead._id);

		const missing = await fetchJson(baseUrl, `/leads/${leadId}/activities`, {
			method: "POST",
			token: adminToken,
			body: { type: "call", outcome: "no_answer" },
		});
		assert(missing.status === 400 && missing.data.code === "FOLLOW_UP_REQUIRED", "API rejects a missing follow-up");

		const noAnswer = await fetchJson(baseUrl, `/leads/${leadId}/activities`, {
			method: "POST",
			token: adminToken,
			body: { type: "call", outcome: "no_answer", nextFollowUpAt: inHours(4) },
		});
		assert(noAnswer.status === 201, "No answer logged");
		assert(noAnswer.data.lead.attemptCount === 1 && noAnswer.data.lead.status === LeadStatus.New, "Attempt counted, still New");
		assert(String(noAnswer.data.lead.owner) === adminId, "First attempt claims the lead");

		const booked = await fetchJson(baseUrl, `/leads/${leadId}/activities`, {
			method: "POST",
			token: adminToken,
			body: { type: "call", outcome: "visit_booked", visitAt: inHours(24), note: "Coming with a friend" },
		});
		assert(booked.status === 201 && booked.data.lead.status === LeadStatus.VisitBooked, "Visit booked moves the lead");
		assert(booked.data.lead.temperature === "hot" && booked.data.lead.attemptCount === 2, "Hot, two attempts");

		const note = await fetchJson(baseUrl, `/leads/${leadId}/activities`, {
			method: "POST",
			token: adminToken,
			body: { type: "note", note: "Prefers mornings" },
		});
		assert(note.status === 201, "Note added");

		const visited = await fetchJson(baseUrl, `/leads/${leadId}/activities`, {
			method: "POST",
			token: adminToken,
			body: { type: "visit", outcome: "visited_deciding", nextFollowUpAt: inHours(48) },
		});
		assert(visited.data.lead.status === LeadStatus.Qualified, "Visited → Qualified (Visited column)");

		const timeline = await fetchJson(baseUrl, `/leads/${leadId}/activities`, { token: adminToken });
		const kinds = timeline.data.items.map((i: { outcome: string; type: string }) => i.outcome || i.type);
		assert(timeline.status === 200 && timeline.data.items.length === 5, "Timeline has 5 entries");
		assert(
			JSON.stringify(kinds) === JSON.stringify(["visited_deciding", "note", "visit_booked", "no_answer", "created"]),
			"Timeline is newest first",
		);
		assert(timeline.data.items[2].note === "Coming with a friend", "Notes kept on outcomes");
		assert(timeline.data.items[1].createdBy.role === "admin", "Who logged it is recorded");

		console.log("\n🔎 Board moves are recorded");
		const noVisit = await fetchJson(baseUrl, "/leads", {
			method: "POST",
			token: adminToken,
			body: { leadName: "Board Lead", phone: `97${stamp}02`, status: LeadStatus.Contacted },
		});
		const boardId = String(noVisit.data.lead._id);
		const bad = await fetchJson(baseUrl, `/leads/${boardId}`, {
			method: "PATCH",
			token: adminToken,
			body: { status: LeadStatus.VisitBooked },
		});
		assert(bad.status === 400 && bad.data.code === "VISIT_AT_REQUIRED", "Moving to Visit booked needs a time");
		const moved = await fetchJson(baseUrl, `/leads/${boardId}`, {
			method: "PATCH",
			token: adminToken,
			body: { status: LeadStatus.VisitBooked, visitAt: inHours(30) },
		});
		assert(moved.status === 200 && moved.data.lead.status === LeadStatus.VisitBooked, "Moved with a visit time");
		await new Promise((r) => setTimeout(r, 100));
		const change = await LeadActivity.findOne({ leadId: boardId, type: "status_change" }).lean();
		assert(
			change?.statusFrom === LeadStatus.Contacted && change?.statusTo === LeadStatus.VisitBooked,
			"Status change logged on the timeline",
		);

		console.log("\n🔎 Trainer access is admin-controlled");
		const trainer = await Trainer.create({
			trainerName: "Lead Trainer",
			email: `lead_trainer_${stamp}@fitflix.test`,
			phone: "9000000000",
			passwordHash: "x",
		});
		const trainerToken = generateTestToken("trainer", String(trainer._id));
		const denied = await fetchJson(baseUrl, "/leads", { token: trainerToken });
		assert(denied.status === 403 && denied.data.code === "LEAD_ACCESS_DENIED", "Trainer without access can't see leads");
		const referral = await fetchJson(baseUrl, "/leads", {
			method: "POST",
			token: trainerToken,
			body: { leadName: "Referred Friend", phone: `97${stamp}03` },
		});
		assert(referral.status === 201, "…but can still add a referral");
		const selfGrant = await fetchJson(baseUrl, `/trainers/${trainer._id}`, {
			method: "PATCH",
			token: trainerToken,
			body: { canAccessLeads: true },
		});
		assert(
			!(await Trainer.findById(trainer._id).lean())?.canAccessLeads,
			`Trainer can't grant themselves access (status ${selfGrant.status})`,
		);
		const grant = await fetchJson(baseUrl, `/trainers/${trainer._id}`, {
			method: "PATCH",
			token: adminToken,
			body: { canAccessLeads: true },
		});
		assert(grant.status === 200, "Admin grants access");
		const allowed = await fetchJson(baseUrl, "/leads", { token: trainerToken });
		assert(allowed.status === 200, "Trainer with access sees leads");
		const trainerLog = await fetchJson(baseUrl, `/leads/${referral.data.lead._id}/activities`, {
			method: "POST",
			token: trainerToken,
			body: { type: "whatsapp", outcome: "details_sent", nextFollowUpAt: inHours(24) },
		});
		assert(trainerLog.status === 201 && trainerLog.data.activity.createdBy.name === "Lead Trainer", "Trainer logs with their name");
		const analyticsDenied = await fetchJson(baseUrl, "/leads/analytics", { token: trainerToken });
		assert(analyticsDenied.status === 403, "Team analytics stay admin/front desk only");

		console.log("\n🔎 Analytics come from the activity log");
		const analytics = await fetchJson(baseUrl, "/leads/analytics", { token: adminToken });
		assert(analytics.status === 200, "Analytics load");
		const me = analytics.data.staff.find((s: { staffId: string }) => s.staffId === adminId);
		assert(me?.attempts >= 3 && me?.visitsBooked >= 1, "Staff row counts attempts and visits booked");
		assert(
			analytics.data.outcomes.some((o: { outcome: string }) => o.outcome === "no_answer"),
			"Outcome breakdown includes no-answers",
		);
		assert(analytics.data.totals.contacted >= 1 && analytics.data.totals.contactRate > 0, "Contact rate computed");
		assert(analytics.data.funnel[2].stage === "Visit booked" && analytics.data.funnel[2].count >= 1, "Funnel counts visits booked");

		const outcomes = await fetchJson(baseUrl, "/leads/outcomes", { token: adminToken });
		assert(
			outcomes.status === 200 &&
				outcomes.data.outcomes.some((o: { key: string }) => o.key === "custom") &&
				outcomes.data.lostReasons.length === 9,
			"Outcome catalog served with custom option and lost reasons",
		);

		await Lead.deleteMany({ phone: { $regex: `^97${stamp}` } });
		await Trainer.deleteOne({ _id: trainer._id });
	} finally {
		await close();
	}
}

async function run() {
	console.log("\n🧪 Lead activity & outcomes");
	ruleTests();
	await apiTests();
	await mongoose.disconnect();
	console.log("\n✅ All lead activity tests passed");
}

run().then(
	() => process.exit(0),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
