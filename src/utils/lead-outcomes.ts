import { LeadStatus } from "../models/Enums";

/**
 * What staff can log against a lead, and what each outcome does to it.
 *
 * The desk renders its "Log outcome" dialog from this catalog (served by
 * GET /leads/outcomes), so labels and required fields live in one place.
 * `applyLeadOutcome` is the single place the rules are enforced.
 */

export type LeadTemperature = "hot" | "warm" | "cold";
export type LeadActivityType =
	| "call"
	| "whatsapp"
	| "visit"
	| "note"
	| "status_change"
	| "system";

/** Channels staff log an outcome on. */
export const OUTCOME_CHANNELS = ["call", "whatsapp", "visit"] as const;
export type OutcomeChannel = (typeof OUTCOME_CHANNELS)[number];

export type OutcomeGroup = "connected" | "not_connected" | "visit" | "other";

export interface LeadOutcomeDefinition {
	key: string;
	label: string;
	group: OutcomeGroup;
	channels: OutcomeChannel[];
	/** True when we actually spoke/met: counts as contact, resets no-answer streak. */
	connected: boolean;
	/** Status this outcome moves the lead to (forward-only unless `force`). */
	status?: LeadStatus;
	/** Move to `status` even if it is behind the current one. */
	force?: boolean;
	temperature?: LeadTemperature | "cooler";
	requires: {
		followUp?: boolean;
		visitAt?: boolean;
		lostReason?: boolean;
		customLabel?: boolean;
	};
	/** Counts towards the consecutive no-answer streak. */
	noAnswer?: boolean;
	/** Suggested follow-up offset in hours when the dialog opens. */
	suggestFollowUpHours?: number;
	/** Fixed lost reason (e.g. wrong number). */
	lostReason?: string;
}

const CALL_AND_WA: OutcomeChannel[] = ["call", "whatsapp"];

export const LEAD_OUTCOMES: LeadOutcomeDefinition[] = [
	// ── Spoke to them ─────────────────────────────────────────────────────
	{
		key: "visit_booked",
		label: "Interested — visit / trial booked",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.VisitBooked,
		temperature: "hot",
		requires: { visitAt: true },
	},
	{
		key: "interested_deciding",
		label: "Interested — will decide",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.Contacted,
		temperature: "warm",
		requires: { followUp: true },
		suggestFollowUpHours: 48,
	},
	{
		key: "details_sent",
		label: "Asked for price / details — sent",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.Contacted,
		temperature: "warm",
		requires: { followUp: true },
		suggestFollowUpHours: 24,
	},
	{
		key: "call_back_later",
		label: "Busy — asked to call back later",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.Contacted,
		requires: { followUp: true },
		suggestFollowUpHours: 4,
	},
	{
		key: "out_of_town",
		label: "Out of town / will join later",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.Contacted,
		temperature: "cold",
		requires: { followUp: true },
		suggestFollowUpHours: 24 * 14,
	},
	{
		key: "not_interested",
		label: "Not interested",
		group: "connected",
		channels: CALL_AND_WA,
		connected: true,
		status: LeadStatus.Lost,
		force: true,
		requires: { lostReason: true },
	},
	// ── Couldn't reach them ───────────────────────────────────────────────
	{
		key: "no_answer",
		label: "No answer / busy",
		group: "not_connected",
		channels: ["call"],
		connected: false,
		noAnswer: true,
		requires: { followUp: true },
		suggestFollowUpHours: 4,
	},
	{
		key: "switched_off",
		label: "Switched off / not reachable",
		group: "not_connected",
		channels: ["call"],
		connected: false,
		noAnswer: true,
		requires: { followUp: true },
		suggestFollowUpHours: 24,
	},
	{
		key: "whatsapp_no_reply",
		label: "Message sent — no reply yet",
		group: "not_connected",
		channels: ["whatsapp"],
		connected: false,
		noAnswer: true,
		requires: { followUp: true },
		suggestFollowUpHours: 24,
	},
	{
		key: "wrong_number",
		label: "Wrong / invalid number",
		group: "not_connected",
		channels: CALL_AND_WA,
		connected: false,
		status: LeadStatus.Lost,
		force: true,
		lostReason: "invalid_number",
		requires: {},
	},
	{
		key: "unreachable_close",
		label: "Can't reach — close as Lost",
		group: "not_connected",
		channels: CALL_AND_WA,
		connected: false,
		status: LeadStatus.Lost,
		force: true,
		lostReason: "unreachable",
		requires: {},
	},
	// ── Visits ────────────────────────────────────────────────────────────
	{
		key: "visited_joining",
		label: "Visited — wants to join",
		group: "visit",
		channels: ["visit"],
		connected: true,
		status: LeadStatus.Qualified,
		temperature: "hot",
		requires: { followUp: true },
		suggestFollowUpHours: 4,
	},
	{
		key: "visited_deciding",
		label: "Visited — still deciding",
		group: "visit",
		channels: ["visit"],
		connected: true,
		status: LeadStatus.Qualified,
		temperature: "warm",
		requires: { followUp: true },
		suggestFollowUpHours: 48,
	},
	{
		key: "visit_rescheduled",
		label: "Visit rescheduled",
		group: "visit",
		channels: ["visit", "call", "whatsapp"],
		connected: true,
		status: LeadStatus.VisitBooked,
		force: true,
		requires: { visitAt: true },
	},
	{
		key: "no_show",
		label: "Didn't turn up",
		group: "visit",
		channels: ["visit"],
		connected: false,
		status: LeadStatus.Contacted,
		force: true,
		temperature: "cooler",
		requires: { followUp: true },
		suggestFollowUpHours: 4,
	},
	{
		key: "visited_not_interested",
		label: "Visited — not joining",
		group: "visit",
		channels: ["visit"],
		connected: true,
		status: LeadStatus.Lost,
		force: true,
		requires: { lostReason: true },
	},
	// ── Anything else ─────────────────────────────────────────────────────
	{
		key: "custom",
		label: "Something else…",
		group: "other",
		channels: ["call", "whatsapp", "visit"],
		connected: true,
		requires: { customLabel: true },
	},
];

export const LOST_REASONS: Array<{ key: string; label: string }> = [
	{ key: "price", label: "Price too high" },
	{ key: "location", label: "Location / too far" },
	{ key: "timing", label: "Timings don't suit" },
	{ key: "other_gym", label: "Joined another gym" },
	{ key: "just_enquiring", label: "Just enquiring" },
	{ key: "medical", label: "Medical reason" },
	{ key: "unreachable", label: "Unreachable" },
	{ key: "invalid_number", label: "Wrong / invalid number" },
	{ key: "other", label: "Other" },
];

/** No-answers in a row before a lead goes Cold. */
export const COLD_AFTER_NO_ANSWERS = 3;
/** Attempts, spread over at least this many days, before we suggest Lost. */
export const SUGGEST_LOST_AFTER_ATTEMPTS = 6;
export const SUGGEST_LOST_AFTER_DAYS = 7;

const OUTCOME_BY_KEY = new Map(LEAD_OUTCOMES.map((o) => [o.key, o]));
export const getOutcome = (key: string) => OUTCOME_BY_KEY.get(key) ?? null;

/** Open pipeline order; Lost and Converted sit outside it. */
const PIPELINE: LeadStatus[] = [
	LeadStatus.New,
	LeadStatus.Contacted,
	LeadStatus.VisitBooked,
	LeadStatus.Qualified,
];
const rank = (status: string) => {
	// Legacy temperature-as-status values sit with Contacted.
	if (
		status === LeadStatus.Warm ||
		status === LeadStatus.Hot ||
		status === LeadStatus.Cold
	) {
		return 1;
	}
	const i = PIPELINE.indexOf(status as LeadStatus);
	return i < 0 ? -1 : i;
};

const COOLER: Record<string, LeadTemperature> = {
	hot: "warm",
	warm: "cold",
	cold: "cold",
};

export interface LeadSnapshot {
	status: string;
	temperature?: string | null;
	attemptCount?: number | null;
	noAnswerStreak?: number | null;
	firstAttemptAt?: Date | null;
	firstContactedAt?: Date | null;
	visitAt?: Date | null;
}

export interface OutcomeInput {
	channel: OutcomeChannel;
	outcome: string;
	customLabel?: string;
	/** Custom outcomes only: where to move the lead. */
	customStatus?: LeadStatus;
	/** Custom outcomes only: did we actually speak to / meet them? Default yes. */
	customConnected?: boolean;
	/** Overrides the outcome's default temperature. */
	temperature?: LeadTemperature;
	nextFollowUpAt?: Date | null;
	visitAt?: Date | null;
	lostReason?: string;
	lostReasonText?: string;
}

export class LeadOutcomeError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
	}
}

export interface OutcomeResult {
	/** Fields to $set on the lead. */
	set: Record<string, unknown>;
	/** Fields to $inc on the lead. */
	inc: Record<string, number>;
	statusFrom: string;
	statusTo: string;
	label: string;
	lostReason: string;
	connected: boolean;
	/** The lead now meets the "give up?" rule; the desk offers Lost. */
	suggestLost: boolean;
}

const OPEN_STATUSES_FOR_CUSTOM = new Set<string>([
	LeadStatus.New,
	LeadStatus.Contacted,
	LeadStatus.VisitBooked,
	LeadStatus.Qualified,
	LeadStatus.Lost,
]);

/**
 * Works out what logging `input` against `lead` changes. Pure: no database.
 * Throws LeadOutcomeError when a required field is missing.
 */
export const applyLeadOutcome = (
	lead: LeadSnapshot,
	input: OutcomeInput,
	now: Date = new Date(),
): OutcomeResult => {
	const def = getOutcome(input.outcome);
	if (!def) {
		throw new LeadOutcomeError(`Unknown outcome "${input.outcome}"`, "UNKNOWN_OUTCOME");
	}
	if (!def.channels.includes(input.channel)) {
		throw new LeadOutcomeError(
			`"${def.label}" can't be logged for a ${input.channel}`,
			"OUTCOME_CHANNEL_MISMATCH",
		);
	}
	if (lead.status === LeadStatus.Converted && def.status === LeadStatus.Lost) {
		throw new LeadOutcomeError(
			"This lead has already joined; it can't be marked Lost",
			"LEAD_CONVERTED",
		);
	}

	const customLabel = input.customLabel?.trim() ?? "";
	if (def.requires.customLabel && !customLabel) {
		throw new LeadOutcomeError("Describe what happened", "CUSTOM_LABEL_REQUIRED");
	}
	if (input.customStatus && !OPEN_STATUSES_FOR_CUSTOM.has(input.customStatus)) {
		throw new LeadOutcomeError("That status can't be set here", "INVALID_STATUS");
	}

	const connected =
		def.key === "custom" ? input.customConnected !== false : def.connected;

	// Target status
	const wanted = def.key === "custom" ? input.customStatus : def.status;
	let statusTo = lead.status;
	if (lead.status !== LeadStatus.Converted && wanted) {
		const reopening = lead.status === LeadStatus.Lost;
		if (
			def.force ||
			def.key === "custom" ||
			reopening ||
			rank(wanted) > rank(lead.status)
		) {
			statusTo = wanted;
		}
	}
	// First real conversation moves a New lead on even without a status.
	if (connected && statusTo === LeadStatus.New && def.key !== "custom") {
		statusTo = LeadStatus.Contacted;
	}
	// Speaking to a Lost lead (without closing it again) reopens it.
	if (
		connected &&
		lead.status === LeadStatus.Lost &&
		statusTo === LeadStatus.Lost &&
		wanted !== LeadStatus.Lost
	) {
		statusTo = LeadStatus.Contacted;
	}

	const isLost = statusTo === LeadStatus.Lost;
	const isOpen = !isLost && statusTo !== LeadStatus.Converted;
	const isVisitBooked = statusTo === LeadStatus.VisitBooked;

	// Required fields
	const visitAt = input.visitAt ?? null;
	if (def.requires.visitAt && !visitAt) {
		throw new LeadOutcomeError("Pick the visit date and time", "VISIT_AT_REQUIRED");
	}
	// Staying in Visit booked keeps the visit already on the calendar.
	const effectiveVisitAt = visitAt ?? (isVisitBooked ? lead.visitAt ?? null : null);
	if (isVisitBooked && !effectiveVisitAt) {
		throw new LeadOutcomeError("Pick the visit date and time", "VISIT_AT_REQUIRED");
	}
	let nextFollowUpAt = input.nextFollowUpAt ?? null;
	if (isVisitBooked && !nextFollowUpAt) nextFollowUpAt = effectiveVisitAt;
	if (isOpen && !nextFollowUpAt) {
		throw new LeadOutcomeError(
			"Pick when to follow up next",
			"FOLLOW_UP_REQUIRED",
		);
	}
	let lostReason = "";
	if (isLost) {
		lostReason = def.lostReason ?? input.lostReason?.trim() ?? "";
		if (!lostReason) {
			throw new LeadOutcomeError("Pick why the lead was lost", "LOST_REASON_REQUIRED");
		}
		if (lostReason === "other" && input.lostReasonText?.trim()) {
			lostReason = `other: ${input.lostReasonText.trim()}`;
		}
	}

	// Counters
	const prevStreak = lead.noAnswerStreak ?? 0;
	const noAnswerStreak = def.noAnswer ? prevStreak + 1 : connected ? 0 : prevStreak;
	const firstAttemptAt = lead.firstAttemptAt ?? now;

	// Temperature
	let temperature: string | null | undefined = lead.temperature ?? null;
	if (input.temperature) {
		temperature = input.temperature;
	} else if (def.temperature === "cooler") {
		temperature = temperature ? COOLER[temperature] ?? "cold" : "cold";
	} else if (def.temperature) {
		temperature = def.temperature;
	}
	if (def.noAnswer && noAnswerStreak >= COLD_AFTER_NO_ANSWERS && !input.temperature) {
		temperature = "cold";
	}

	const suggestLost =
		isOpen &&
		noAnswerStreak >= SUGGEST_LOST_AFTER_ATTEMPTS &&
		now.getTime() - new Date(firstAttemptAt).getTime() >=
			SUGGEST_LOST_AFTER_DAYS * 24 * 3600_000;

	const set: Record<string, unknown> = {
		status: statusTo,
		temperature,
		noAnswerStreak,
		lastAttemptAt: now,
		firstAttemptAt,
		lastOutcome: def.key,
		lastOutcomeLabel: def.key === "custom" ? customLabel : def.label,
		followUpDate: isOpen ? nextFollowUpAt : null,
		lostReason: isLost ? lostReason : "",
	};
	if (visitAt) set.visitAt = visitAt;
	if (def.key === "no_show") set.visitAt = null;
	if (connected) {
		set.lastContactedAt = now;
		if (!lead.firstContactedAt) set.firstContactedAt = now;
	}

	return {
		set,
		inc: { attemptCount: 1 },
		statusFrom: lead.status,
		statusTo,
		label: def.key === "custom" ? customLabel : def.label,
		lostReason,
		connected: connected,
		suggestLost,
	};
};
