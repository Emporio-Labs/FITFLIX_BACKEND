import Lead from "../models/Lead";
import { LeadStatus } from "../models/Enums";

export interface FollowUpOutbox {
	leadId: string;
	leadName: string;
	phone: string;
	milestone: "24h" | "72h" | "7d";
	message: string;
}

export async function processLeadFollowups(): Promise<{ processedCount: number; messages: FollowUpOutbox[] }> {
	const now = new Date();
	const outbox: FollowUpOutbox[] = [];

	// Fetch leads that are either New or Contacted (excluding Converted/Lost)
	const leads = await Lead.find({
		status: { $in: [LeadStatus.New, LeadStatus.Contacted] },
	});

	console.log(`[LeadFollowUp] Found ${leads.length} leads eligible for lifecycle follow-up analysis`);

	for (const lead of leads) {
		if (!lead.createdAt || !lead.phone) continue;

		const ageMs = now.getTime() - new Date(lead.createdAt).getTime();
		const ageHours = ageMs / (1000 * 60 * 60);

		const tags = lead.tags || [];

		// Milestone 3: 7 Days (approx 168 hours)
		if (ageHours >= 168 && !tags.includes("followup-7d-sent")) {
			const msg = `Hello ${lead.leadName}! Ready to transform your health? Speak to our concierge or select your protocol program directly in the mobile app: fitflix://dashboard/protocols`;
			outbox.push({
				leadId: String(lead._id),
				leadName: lead.leadName,
				phone: lead.phone,
				milestone: "7d",
				message: msg,
			});
			lead.tags = [...tags, "followup-7d-sent"];
			lead.status = LeadStatus.Contacted;
			await lead.save();
		}
		// Milestone 2: 72 Hours (approx 72 hours)
		else if (ageHours >= 72 && !tags.includes("followup-72h-sent") && !tags.includes("followup-7d-sent")) {
			const msg = `Hi ${lead.leadName}, we noticed you haven't activated your FitFlix membership plan. Check out our sanitised protocols and exclusive modules in the app: fitflix://dashboard/protocols`;
			outbox.push({
				leadId: String(lead._id),
				leadName: lead.leadName,
				phone: lead.phone,
				milestone: "72h",
				message: msg,
			});
			lead.tags = [...tags, "followup-72h-sent"];
			lead.status = LeadStatus.Contacted;
			await lead.save();
		}
		// Milestone 1: 24 Hours (approx 24 hours)
		else if (ageHours >= 24 && !tags.includes("followup-24h-sent") && !tags.includes("followup-72h-sent") && !tags.includes("followup-7d-sent")) {
			const msg = `Hey ${lead.leadName}, thanks for showing interest in FitFlix Sainikpuri! Access the app here to pick your customized training protocols: fitflix://dashboard/protocols`;
			outbox.push({
				leadId: String(lead._id),
				leadName: lead.leadName,
				phone: lead.phone,
				milestone: "24h",
				message: msg,
			});
			lead.tags = [...tags, "followup-24h-sent"];
			lead.status = LeadStatus.Contacted;
			await lead.save();
		}
	}

	console.log(`[LeadFollowUp] Processed and queued ${outbox.length} follow-up outreach messages`);
	return {
		processedCount: outbox.length,
		messages: outbox,
	};
}
