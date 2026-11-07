import { LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";
import Location from "../models/Location";
import { logLeadActivity } from "../services/lead-activity.service";
import { findExistingLead } from "./lead-match";
import type { ApplicationInput, LeadRoute } from "../validators/presale-founders.validator";

const SOURCE = "kompally-founders-club";

type Submission = { applicationId: string; input: ApplicationInput; route: LeadRoute; fitScore: number };

/** Plain-text summary shared by the CRM lead notes and the WhatsApp message. */
export function formatFounderSubmission({ applicationId, input, route, fitScore }: Submission): string {
	const { contact: c, answers: a, attribution: u } = input;
	const utm = [u.source, u.medium, u.campaign].filter(Boolean).join(" / ");
	return [
		"Kompally Founders Club application",
		`Name: ${c.name}`,
		`Phone: ${c.phone}`,
		`Email: ${c.email}`,
		`Preferred channel: ${c.channel}`,
		`Route: ${route} (fit ${fitScore}/100)`,
		`Goals: ${a.goals.join(", ")}`,
		`Location: ${a.location}`,
		`Why: ${a.motivation}`,
		`Current routine: ${a.routine}`,
		`Barrier: ${a.barrier}`,
		`Support wanted: ${a.support}`,
		`Sessions/week: ${a.sessions}`,
		`Windows: ${a.windows.join(", ")}`,
		`Timeline: ${a.timeline}`,
		`Investment: ${a.investment}`,
		`Decision: ${a.decision}`,
		`Priority: ${a.buyingPriority ?? "-"}`,
		`Hesitation: ${a.hesitation ?? "-"}`,
		`Next step: ${a.nextStep}`,
		a.pledge ? `Intention: ${a.pledge}` : null,
		`Marketing consent: ${c.marketingConsent ? "yes" : "no"}`,
		utm ? `UTM: ${utm}` : null,
		`Application ID: ${applicationId}`,
	]
		.filter(Boolean)
		.join("\n");
}

/** Creates (or updates) a lead in the existing CRM Leads list for this submission. */
export async function syncFounderLeadToCrm(submission: Submission, summary: string) {
	const { input, route, applicationId } = submission;
	const tags = ["founders-club", "kompally", `founders-route:${route}`];
	const publicCapture = { formType: "founders-club", applicationId, answers: input.answers, attribution: input.attribution, submittedAt: new Date() };
	const existing = await findExistingLead({ phone: input.contact.phone, email: input.contact.email });

	if (existing && existing.status !== LeadStatus.Converted) {
		await Lead.updateOne(
			{ _id: existing._id },
			{
				$set: {
					notes: [existing.notes?.trim(), summary].filter(Boolean).join("\n\n"),
					publicCapture,
					...(existing.status === LeadStatus.Lost ? { status: LeadStatus.New } : {}),
					...(!existing.email ? { email: input.contact.email } : {}),
					// The phone stood in as the name until a real one arrived.
					...(existing.leadName === existing.phone ? { leadName: input.contact.name } : {}),
				},
				$addToSet: { tags: { $each: [...tags, "repeat-enquiry"] } },
			},
		);
		void logLeadActivity({ leadId: existing._id, locationId: existing.locationId, type: "system", outcome: "enquired_again", label: "Applied via Kompally Founders Club", note: "", statusFrom: existing.status, statusTo: existing.status === LeadStatus.Lost ? LeadStatus.New : existing.status });
		return;
	}

	const kompally = await Location.findOne({ name: /kompally/i }).select("_id").lean();
	const lead = await Lead.create({
		leadName: input.contact.name,
		email: input.contact.email,
		phone: input.contact.phone,
		source: SOURCE,
		status: LeadStatus.New,
		interestedIn: input.answers.support,
		notes: summary,
		tags: existing ? [...tags, "existing-member"] : tags,
		publicCapture,
		...(kompally ? { locationId: kompally._id } : {}),
	});
	void logLeadActivity({ leadId: lead._id, locationId: lead.locationId, type: "system", outcome: "created", label: "Enquiry via Kompally Founders Club", note: "", statusTo: lead.status });
}

/**
 * Sends the summary to the team's WhatsApp number via the WhatsApp Business
 * Cloud API. No-op until WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and
 * FOUNDERS_WHATSAPP_TO are set. If WHATSAPP_TEMPLATE_NAME is set, an approved
 * template with one body variable is used (required outside the 24h window);
 * otherwise a plain text message is sent.
 */
export async function sendFounderWhatsApp(summary: string) {
	const token = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
	const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
	const recipients = (process.env.FOUNDERS_WHATSAPP_TO ?? "").split(",").map((n) => n.replace(/\D/g, "")).filter(Boolean);
	if (!token || !phoneNumberId || recipients.length === 0) return;

	const template = process.env.WHATSAPP_TEMPLATE_NAME?.trim();
	// Template variables cannot contain newlines or long runs of spaces.
	const content = template
		? { type: "template", template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: summary.replace(/\n+/g, " | ").slice(0, 1000) }] }] } }
		: { type: "text", text: { body: summary.slice(0, 4096) } };

	await Promise.all(
		recipients.map(async (to) => {
			const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ messaging_product: "whatsapp", to, ...content }),
				signal: AbortSignal.timeout(10000),
			});
			if (!res.ok) throw new Error(`WhatsApp send to ${to} failed: ${res.status} ${await res.text()}`);
		}),
	);
}

/** Fire-and-forget: a failure here must never fail the applicant's submission. */
export function notifyFounderSubmission(submission: Submission) {
	const summary = formatFounderSubmission(submission);
	void syncFounderLeadToCrm(submission, summary).catch((err) => console.error("[founders] CRM lead sync failed", err));
	void sendFounderWhatsApp(summary).catch((err) => console.error("[founders] WhatsApp notify failed", err));
}
