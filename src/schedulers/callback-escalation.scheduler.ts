import { LeadStatus } from "../models/Enums";
import Lead from "../models/Lead";

/**
 * Sweeps every 2 minutes for payment fallback callback leads that remain
 * untouched after the 15-minute SLA deadline.
 */
export const runCallbackEscalationSweep = async () => {
	const now = new Date();

	try {
		const overdueLeads = await Lead.find({
			source: "APP_PAYMENT_FALLBACK",
			status: LeadStatus.New,
			isEscalated: { $ne: true },
			slaDeadline: { $lte: now },
		});

		for (const lead of overdueLeads) {
			await Lead.findByIdAndUpdate(lead._id, {
				$set: {
					isEscalated: true,
					notes: `${lead.notes || ""} [SLA_ESCALATED] Lead untouched for >15 minutes. High Priority.`,
				},
			});
			console.warn(
				`[CALLBACK_LEAD_ESCALATED] Lead ${lead._id.toString()} (${lead.leadName}, ${lead.phone}) escalated to High Priority.`,
			);
		}
	} catch (error) {
		console.error("[CALLBACK_ESCALATION_SWEEP_ERROR]", error);
	}
};
