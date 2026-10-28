import mongoose from "mongoose";
import {
	AlertSeverity,
	AlertStatus,
	AlertType,
	LeadStatus,
} from "../models/Enums";
import Lead from "../models/Lead";
import Location from "../models/Location";
import OperationalAlert from "../models/OperationalAlert";
import { logLeadActivity } from "../services/lead-activity.service";
import { emitOperationalAlert } from "../services/realtime.service";
import { isSalesStaffOnDuty } from "../services/staff-presence.service";
import { getEffectiveAlertRule } from "../utils/default-alert-rules";

/** Statuses of a lead someone is working; its follow-up dates are watched. */
const OPEN_WORKED_STATUSES = [
	LeadStatus.Contacted,
	LeadStatus.VisitBooked,
	LeadStatus.Qualified,
	LeadStatus.Warm,
	LeadStatus.Hot,
	LeadStatus.Cold,
];
const OPEN_FOLLOW_UP_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

export interface LeadSlaSweepMetrics {
	unclaimedChecked: number;
	unclaimedAlerted: number;
	callbacksChecked: number;
	callbacksAlerted: number;
}

/**
 * FX-42.1 & FX-42.2: Sweeps for:
 * 1. New leads that remain unclaimed past the configured time limit (FX-36 AlertRule).
 * 2. Requested callbacks that haven't been completed by their due time.
 *
 * FX-42.3: If no sales person is on duty at the branch, routes alert directly to branch_manager.
 * FX-42.4: Sets autoResolveKey so alerts resolve when claimed or callback logged.
 */
export const runLeadSlaAndEscalationSweep = async (
	now: Date = new Date(),
): Promise<LeadSlaSweepMetrics> => {
	const metrics: LeadSlaSweepMetrics = {
		unclaimedChecked: 0,
		unclaimedAlerted: 0,
		callbacksChecked: 0,
		callbacksAlerted: 0,
	};

	try {
		// 1. Fetch effective rule for grace period / time limit (FX-36)
		const rule = await getEffectiveAlertRule(AlertType.LeadUnclaimed);
		const timeLimitMinutes =
			rule.gracePeriodMinutes ?? (rule.escalationLadder?.[0]?.afterMinutes ?? 15);
		const unclaimedCutoff = new Date(now.getTime() - timeLimitMinutes * 60_000);

		// Resolve default branch fallback
		const defaultBranch = await Location.findOne({ isActive: true })
			.select("_id")
			.lean();
		const defaultBranchId = defaultBranch
			? (defaultBranch._id as mongoose.Types.ObjectId)
			: undefined;

		// -------------------------------------------------------------
		// FX-42.1: Check Unclaimed New Leads past time limit
		// -------------------------------------------------------------
		const unclaimedLeads = await Lead.find({
			status: LeadStatus.New,
			owner: { $in: [null, undefined] },
			createdAt: { $lte: unclaimedCutoff },
		}).lean();

		metrics.unclaimedChecked = unclaimedLeads.length;

		if (unclaimedLeads.length > 0) {
			const leadIds = unclaimedLeads.map((l) => l._id.toString());
			const existingAlerts = await OperationalAlert.find({
				type: AlertType.LeadUnclaimed,
				$or: [
					{ autoResolveKey: { $in: leadIds.map((id) => `lead:${id}`) } },
					{
						"relatedEntity.entityType": "lead",
						"relatedEntity.entityId": { $in: leadIds },
					},
				],
				status: { $in: [AlertStatus.Open, AlertStatus.Acknowledged] },
			})
				.select("autoResolveKey relatedEntity.entityId")
				.lean();

			const activeAlertSet = new Set<string>();
			for (const a of existingAlerts) {
				if (a.relatedEntity?.entityId) {
					activeAlertSet.add(a.relatedEntity.entityId);
				}
				if (a.autoResolveKey?.startsWith("lead:")) {
					activeAlertSet.add(a.autoResolveKey.slice(5));
				}
			}

			for (const lead of unclaimedLeads) {
				const leadIdStr = lead._id.toString();
				if (activeAlertSet.has(leadIdStr)) continue;

				const targetBranchId = lead.locationId || defaultBranchId;
				if (!targetBranchId) continue;

				// FX-42.3: Check if sales staff is on duty at this branch
				const salesOnDuty = await isSalesStaffOnDuty(targetBranchId);

				const targetRoles = salesOnDuty
					? [rule.firstResponderRole || "frontdesk"]
					: ["branch_manager", "admin"];
				const escalationLadder = salesOnDuty
					? rule.escalationLadder || []
					: [{ role: "admin", afterMinutes: 15 }];
				const title = salesOnDuty
					? `Unclaimed Lead: ${lead.leadName}`
					: `[Direct to Manager] Unclaimed Lead: ${lead.leadName}`;
				const message = salesOnDuty
					? `New lead has remained unclaimed for over ${timeLimitMinutes} minutes (${lead.phone || lead.email || "Contact pending"}). First responder: ${rule.firstResponderRole || "frontdesk"}.`
					: `Lead unclaimed for >${timeLimitMinutes} minutes with no sales staff on duty at branch. Escalated directly to Branch Manager. Lead contact: ${lead.phone || lead.email || "not given"}.`;

				const alert = await OperationalAlert.create({
					type: AlertType.LeadUnclaimed,
					severity: rule.severity || AlertSeverity.Warning,
					status: AlertStatus.Open,
					title,
					message,
					branchId: targetBranchId,
					targetRoles,
					sound: rule.sound || "chime",
					escalationLadder,
					relatedEntity: {
						entityType: "lead",
						entityId: leadIdStr,
						summary: `${lead.leadName} - ${lead.interestedIn || "Membership inquiry"}`,
					},
					autoResolveKey: `lead:${leadIdStr}`,
				});

				emitOperationalAlert(alert.toObject());
				activeAlertSet.add(leadIdStr);
				metrics.unclaimedAlerted++;

				void logLeadActivity({
					leadId: lead._id,
					locationId: lead.locationId,
					type: "system",
					outcome: "escalated",
					label: title,
				});

				// Mark lead escalated in DB
				await Lead.findByIdAndUpdate(lead._id, {
					$set: {
						isEscalated: true,
						notes: lead.notes?.includes("[UNCLAIMED_ESCALATED]")
							? lead.notes
							: `${lead.notes || ""} [UNCLAIMED_ESCALATED] Lead unclaimed for >${timeLimitMinutes}m.`.trim(),
					},
				});
			}
		}

		// -------------------------------------------------------------
		// FX-42.2: Check Overdue Requested Callbacks
		// -------------------------------------------------------------
		// A lead already being worked can miss its follow-up too. Only
		// follow-ups due in the last week count, so leads with long-stale
		// dates don't all alert at once.
		const followUpWindowStart = new Date(
			now.getTime() - OPEN_FOLLOW_UP_LOOKBACK_MS,
		);
		const overdueCallbacks = await Lead.find({
			$or: [
				{
					status: LeadStatus.New,
					$or: [
						{ slaDeadline: { $ne: null, $lte: now } },
						{ followUpDate: { $ne: null, $lte: now } },
						{
							tags: "callback",
							createdAt: { $lte: unclaimedCutoff },
						},
						{
							source: "APP_PAYMENT_FALLBACK",
							createdAt: { $lte: unclaimedCutoff },
						},
					],
				},
				{
					status: { $in: OPEN_WORKED_STATUSES },
					followUpDate: { $gte: followUpWindowStart, $lte: now },
				},
			],
		}).lean();

		metrics.callbacksChecked = overdueCallbacks.length;

		if (overdueCallbacks.length > 0) {
			const callbackLeadIds = overdueCallbacks.map((l) => l._id.toString());
			const existingCallbackAlerts = await OperationalAlert.find({
				type: AlertType.LeadUnclaimed,
				$or: [
					{
						autoResolveKey: {
							$in: callbackLeadIds.map((id) => `lead:${id}`),
						},
					},
					{
						"relatedEntity.entityType": "lead",
						"relatedEntity.entityId": { $in: callbackLeadIds },
					},
				],
				status: { $in: [AlertStatus.Open, AlertStatus.Acknowledged] },
			})
				.select("autoResolveKey relatedEntity.entityId")
				.lean();

			const activeCallbackAlertSet = new Set<string>();
			for (const a of existingCallbackAlerts) {
				if (a.relatedEntity?.entityId) {
					activeCallbackAlertSet.add(a.relatedEntity.entityId);
				}
				if (a.autoResolveKey?.startsWith("lead:")) {
					activeCallbackAlertSet.add(a.autoResolveKey.slice(5));
				}
			}

			for (const lead of overdueCallbacks) {
				const leadIdStr = lead._id.toString();
				if (activeCallbackAlertSet.has(leadIdStr)) continue;

				const targetBranchId = lead.locationId || defaultBranchId;
				if (!targetBranchId) continue;

				// FX-42.3: Check if sales staff is on duty at this branch
				const salesOnDuty = await isSalesStaffOnDuty(targetBranchId);

				const targetRoles = salesOnDuty
					? [rule.firstResponderRole || "frontdesk"]
					: ["branch_manager", "admin"];
				const escalationLadder = salesOnDuty
					? rule.escalationLadder || []
					: [{ role: "admin", afterMinutes: 15 }];
				const isFollowUp = lead.status !== LeadStatus.New;
				const what = isFollowUp ? "Follow-up" : "Callback";
				const contact = `Lead contact: ${lead.phone || lead.email || "not given"}.`;
				const title = salesOnDuty
					? `Overdue ${what}: ${lead.leadName}`
					: `[Direct to Manager] Overdue ${what}: ${lead.leadName}`;
				const message = salesOnDuty
					? `${isFollowUp ? "Scheduled follow-up" : "Requested callback"} due time has passed and has not been made. ${contact} First responder: ${rule.firstResponderRole || "frontdesk"}.`
					: `${isFollowUp ? "Scheduled follow-up" : "Requested callback"} is overdue with no sales staff on duty at branch. Escalated directly to Branch Manager. ${contact}`;

				const alert = await OperationalAlert.create({
					type: AlertType.LeadUnclaimed,
					severity: rule.severity || AlertSeverity.Warning,
					status: AlertStatus.Open,
					title,
					message,
					branchId: targetBranchId,
					targetRoles,
					sound: rule.sound || "chime",
					escalationLadder,
					relatedEntity: {
						entityType: "lead",
						entityId: leadIdStr,
						summary: `${lead.leadName} - ${what} pending`,
					},
					autoResolveKey: `lead:${leadIdStr}`,
				});

				emitOperationalAlert(alert.toObject());
				activeCallbackAlertSet.add(leadIdStr);
				metrics.callbacksAlerted++;

				void logLeadActivity({
					leadId: lead._id,
					locationId: lead.locationId,
					type: "system",
					outcome: "escalated",
					label: title,
				});

				// Mark lead escalated in DB
				await Lead.findByIdAndUpdate(lead._id, {
					$set: {
						isEscalated: true,
						notes: lead.notes?.includes("[SLA_ESCALATED]")
							? lead.notes
							: `${lead.notes || ""} [SLA_ESCALATED] Callback overdue. High Priority.`.trim(),
					},
				});
			}
		}
	} catch (error) {
		console.error("[LEAD_SLA_ESCALATION_SWEEP_ERROR]", error);
	}

	return metrics;
};

/**
 * Backward compatibility alias for index.ts
 */
export const runCallbackEscalationSweep = runLeadSlaAndEscalationSweep;
