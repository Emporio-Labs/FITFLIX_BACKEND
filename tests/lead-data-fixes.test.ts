import mongoose from "mongoose";
import { LeadStatus } from "../src/models/Enums";
import Lead from "../src/models/Lead";
import Location from "../src/models/Location";
import OperationalAlert from "../src/models/OperationalAlert";
import { runLeadSlaAndEscalationSweep } from "../src/schedulers/callback-escalation.scheduler";
import { processLeadFollowups } from "../src/services/lead-followup.scheduler";
import { setSalesStaffOnDutyOverride } from "../src/services/staff-presence.service";
import { recordAppSignupLead } from "../src/utils/lead-match";
import { assert, fetchJson, startTestServer } from "./test-helpers";

// Distinct per run so leftovers from an earlier run never match.
const stamp = String(Date.now()).slice(-6);
const phone = (n: number) => `98${stamp}${String(n).padStart(2, "0")}`;

async function runTests() {
	console.log("\n🧪 Lead data fixes");
	process.env.LEAD_CAPTCHA_REQUIRED = "false";
	const { baseUrl, close } = await startTestServer();

	try {
		let branch = await Location.findOne({ code: "lead_fix_branch" });
		if (!branch) {
			branch = await Location.create({
				name: "Lead Fix Branch",
				code: "lead_fix_branch",
				timezone: "Asia/Kolkata",
				isActive: true,
			});
		}

		// ---------------------------------------------------------------
		console.log("\n🔎 App signup keeps an existing lead's status and notes");
		const worked = await Lead.create({
			leadName: "Worked Lead",
			phone: `+91 ${phone(1)}`,
			source: "walk-in",
			status: LeadStatus.Qualified,
			notes: "Visited Tuesday, wants 3-month plan",
			locationId: branch._id,
		});
		const userId = new mongoose.Types.ObjectId();
		await recordAppSignupLead({
			userId,
			name: "Renamed In App",
			phone: phone(1),
			interestedIn: "Weight loss",
			note: "Age: 30, Gender: male",
		});
		const afterSignup = await Lead.findById(worked._id).lean();
		assert(afterSignup?.status === LeadStatus.Qualified, "Status stays Qualified");
		assert(afterSignup?.source === "walk-in", "Source stays walk-in");
		assert(afterSignup?.leadName === "Worked Lead", "Name is not overwritten");
		assert(
			(afterSignup?.notes ?? "").startsWith("Visited Tuesday") &&
				(afterSignup?.notes ?? "").includes("Signed up in the app (Age: 30"),
			"Old notes kept, signup note appended",
		);
		assert(String(afterSignup?.convertedUser) === String(userId), "Account is linked");
		assert(afterSignup?.tags?.includes("app-signup") === true, "Signup tag added");
		assert(
			(await Lead.countDocuments({ phone: { $regex: `${phone(1)}$` } })) === 1,
			"No second lead created",
		);

		console.log("\n🔎 App signup reopens a Lost lead and creates one when none exists");
		const lost = await Lead.create({
			leadName: "Lost Lead",
			phone: phone(2),
			status: LeadStatus.Lost,
		});
		await recordAppSignupLead({ userId: new mongoose.Types.ObjectId(), name: "x", phone: phone(2) });
		assert(
			(await Lead.findById(lost._id).lean())?.status === LeadStatus.New,
			"Lost lead reopens as New",
		);
		await recordAppSignupLead({
			userId: new mongoose.Types.ObjectId(),
			name: "Brand New",
			phone: phone(3),
		});
		const created = await Lead.findOne({ phone: phone(3) }).lean();
		assert(
			created?.status === LeadStatus.New && created?.source === "app-signup",
			"New app-signup lead created",
		);

		// ---------------------------------------------------------------
		console.log("\n🔎 Website enquiries from the same phone don't duplicate");
		const first = await fetchJson(baseUrl, "/leads/public-capture", {
			method: "POST",
			body: { formType: "callback", phone: phone(4), name: "Web Person" },
		});
		assert(first.status === 202, "First enquiry accepted");
		await Lead.updateOne({ _id: first.data.leadId }, { status: LeadStatus.Contacted });
		const second = await fetchJson(baseUrl, "/leads/public-capture", {
			method: "POST",
			body: { formType: "callback", phone: `+91${phone(4)}`, name: "Web Person", notes: "Second ask" },
		});
		assert(second.status === 202, "Second enquiry accepted");
		assert(String(second.data.leadId) === String(first.data.leadId), "Same lead returned");
		const merged = await Lead.findById(first.data.leadId).lean();
		assert(merged?.status === LeadStatus.Contacted, "Status kept on repeat enquiry");
		assert(merged?.tags?.includes("repeat-enquiry") === true, "Tagged repeat-enquiry");
		assert((merged?.notes ?? "").includes("Second ask"), "New enquiry note appended");

		console.log("\n🔎 A member enquiring again gets a new lead");
		await Lead.updateOne({ _id: first.data.leadId }, { status: LeadStatus.Converted });
		const third = await fetchJson(baseUrl, "/leads/public-capture", {
			method: "POST",
			body: { formType: "callback", phone: phone(4), name: "Web Person" },
		});
		assert(String(third.data.leadId) !== String(first.data.leadId), "Separate lead created");
		const memberLead = await Lead.findById(third.data.leadId).lean();
		assert(memberLead?.tags?.includes("existing-member") === true, "Tagged existing-member");

		// ---------------------------------------------------------------
		console.log("\n🔎 Automated follow-up messages don't mark leads Contacted");
		const quiet = await Lead.create({ leadName: "Quiet", phone: phone(5), status: LeadStatus.New });
		await Lead.collection.updateOne(
			{ _id: quiet._id },
			{ $set: { createdAt: new Date(Date.now() - 30 * 3600_000) } },
		);
		await processLeadFollowups();
		const quietAfter = await Lead.findById(quiet._id).lean();
		assert(quietAfter?.tags?.includes("followup-24h-sent") === true, "24h message queued");
		assert(quietAfter?.status === LeadStatus.New, "Status stays New");

		// ---------------------------------------------------------------
		console.log("\n🔎 Overdue follow-ups alert for leads already being worked");
		setSalesStaffOnDutyOverride(() => true);
		const overdue = await Lead.create({
			leadName: "Overdue Followup",
			phone: phone(6),
			status: LeadStatus.Contacted,
			owner: new mongoose.Types.ObjectId(),
			followUpDate: new Date(Date.now() - 60 * 60_000),
			locationId: branch._id,
		});
		const stale = await Lead.create({
			leadName: "Stale Followup",
			phone: phone(7),
			status: LeadStatus.Qualified,
			followUpDate: new Date(Date.now() - 30 * 24 * 3600_000),
			locationId: branch._id,
		});
		await runLeadSlaAndEscalationSweep();
		const alert = await OperationalAlert.findOne({
			"relatedEntity.entityId": overdue._id.toString(),
		}).lean();
		assert(alert != null, "Alert raised for overdue Contacted lead");
		assert(alert?.title?.startsWith("Overdue Follow-up") === true, "Titled as a follow-up");
		assert(
			alert?.message?.includes(`Lead contact: ${phone(6)}`) === true,
			"Phone labelled as the lead's contact",
		);
		assert(
			(await OperationalAlert.countDocuments({
				"relatedEntity.entityId": stale._id.toString(),
			})) === 0,
			"Follow-up older than a week does not alert",
		);
		setSalesStaffOnDutyOverride(null);

		console.log("\n✅ All lead data fix tests passed");
	} finally {
		await close();
		await mongoose.disconnect();
	}
}

runTests().then(
	() => process.exit(0),
	(err) => {
		console.error(err);
		process.exit(1);
	},
);
