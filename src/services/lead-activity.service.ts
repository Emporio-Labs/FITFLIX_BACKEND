import mongoose from "mongoose";
import { autoResolveOperationalAlerts } from "../controllers/operational-alert.controller";
import Admin from "../models/Admin";
import Lead from "../models/Lead";
import LeadActivity from "../models/LeadActivity";
import Trainer from "../models/Trainer";
import User from "../models/User";
import type { AuthenticatedUser } from "../types/auth";
import { normalizeRole } from "../middleware/rbac.middleware";
import {
	applyLeadOutcome,
	type LeadActivityType,
	type OutcomeInput,
} from "../utils/lead-outcomes";

export interface ActivityActor {
	id: string | null;
	name: string;
	role: string;
}

export const SYSTEM_ACTOR: ActivityActor = { id: null, name: "System", role: "system" };

/** Who did it, with a display name for the timeline. */
export const resolveActor = async (
	user: AuthenticatedUser | undefined,
): Promise<ActivityActor> => {
	if (!user) return SYSTEM_ACTOR;
	const role = normalizeRole(user.role);
	let name = "";
	try {
		if (mongoose.Types.ObjectId.isValid(user.id)) {
			if (role === "admin" || role === "frontdesk") {
				name = (await Admin.findById(user.id).select("adminName").lean())?.adminName ?? "";
			} else if (role === "trainer") {
				name =
					(await Trainer.findById(user.id).select("trainerName").lean())?.trainerName ?? "";
			} else {
				name = (await User.findById(user.id).select("username").lean())?.username ?? "";
			}
		}
	} catch {
		// A missing name only affects display.
	}
	return { id: user.id, name: name || user.email || role, role };
};

export interface LogActivityInput {
	leadId: mongoose.Types.ObjectId | string;
	locationId?: unknown;
	type: LeadActivityType;
	outcome?: string;
	label?: string;
	note?: string;
	statusFrom?: string | null;
	statusTo?: string | null;
	connected?: boolean;
	temperature?: string | null;
	lostReason?: string;
	nextFollowUpAt?: Date | null;
	visitAt?: Date | null;
	actor?: ActivityActor;
}

/**
 * Adds an entry to a lead's timeline. Never throws: losing a history line
 * must not fail the action that caused it.
 */
export const logLeadActivity = async (input: LogActivityInput) => {
	try {
		const { actor = SYSTEM_ACTOR, ...rest } = input;
		return await LeadActivity.create({
			...rest,
			leadId: new mongoose.Types.ObjectId(String(input.leadId)),
			locationId: (input.locationId as mongoose.Types.ObjectId) ?? null,
			createdBy: actor,
		});
	} catch (error) {
		console.error("[LeadActivity] Failed to log activity", error);
		return null;
	}
};

export class LeadNotFoundError extends Error {}

/**
 * Logs a call/WhatsApp/visit outcome: updates the lead per the outcome rules
 * and appends the timeline entry. The first attempt claims an unowned lead.
 */
export const recordLeadOutcome = async (
	leadId: string,
	input: OutcomeInput & { note?: string },
	actor: ActivityActor,
	now: Date = new Date(),
) => {
	const lead = await Lead.findById(leadId);
	if (!lead) throw new LeadNotFoundError("Lead not found");

	const result = applyLeadOutcome(
		{
			status: lead.status,
			temperature: lead.temperature,
			attemptCount: lead.attemptCount,
			noAnswerStreak: lead.noAnswerStreak,
			firstAttemptAt: lead.firstAttemptAt,
			firstContactedAt: lead.firstContactedAt,
			visitAt: lead.visitAt,
		},
		input,
		now,
	);

	const set: Record<string, unknown> = { ...result.set };
	if (!lead.owner && actor.id && mongoose.Types.ObjectId.isValid(actor.id)) {
		set.owner = new mongoose.Types.ObjectId(actor.id);
		set.ownerName = actor.name;
	}
	// A follow-up moved into the future or a closed lead clears the flag the
	// SLA sweep set.
	set.isEscalated = false;

	const updated = await Lead.findByIdAndUpdate(
		leadId,
		{ $set: set, $inc: result.inc },
		{ returnDocument: "after", runValidators: true },
	);

	const activity = await LeadActivity.create({
		leadId: lead._id,
		locationId: lead.locationId ?? null,
		type: input.channel,
		outcome: input.outcome,
		label: result.label,
		connected: result.connected,
		note: input.note?.trim() ?? "",
		statusFrom: result.statusFrom,
		statusTo: result.statusTo,
		temperature: (set.temperature as string | null) ?? null,
		lostReason: result.lostReason,
		nextFollowUpAt: (set.followUpDate as Date | null) ?? null,
		visitAt: input.visitAt ?? null,
		createdBy: actor,
	});

	void autoResolveOperationalAlerts("lead", leadId, "Outcome logged by staff");

	return { lead: updated, activity, suggestLost: result.suggestLost };
};
