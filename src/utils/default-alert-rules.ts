import { AlertSeverity, AlertType } from "../models/Enums";
import AlertRule from "../models/AlertRule";

export interface DefaultAlertRuleConfig {
	alertType: AlertType;
	title: string;
	description: string;
	severity: AlertSeverity;
	firstResponderRole: string;
	escalationLadder: Array<{ role: string; afterMinutes: number }>;
	sound: "chime" | "siren" | "pulse" | "bell";
}

/**
 * Sensible defaults shipped out-of-the-box for every alert type (FX-36.3).
 * Trainer no-shows get minutes; sales leads get longer windows.
 */
export const DEFAULT_ALERT_RULES: Record<AlertType, DefaultAlertRuleConfig> = {
	[AlertType.TrainerMissing]: {
		alertType: AlertType.TrainerMissing,
		title: "Trainer No-Show / Missing",
		description: "Class session starting with unassigned or missing instructor.",
		severity: AlertSeverity.Critical,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 2 },
			{ role: "admin", afterMinutes: 5 },
		],
		sound: "siren",
	},
	[AlertType.SessionStartingNoHost]: {
		alertType: AlertType.SessionStartingNoHost,
		title: "Live Class Started Without Host",
		description: "Room is live but assigned trainer has not checked into the session.",
		severity: AlertSeverity.Critical,
		firstResponderRole: "trainer",
		escalationLadder: [
			{ role: "frontdesk", afterMinutes: 3 },
			{ role: "branch_manager", afterMinutes: 7 },
		],
		sound: "pulse",
	},
	[AlertType.EmergencyCall]: {
		alertType: AlertType.EmergencyCall,
		title: "Medical or Safety Incident",
		description: "SOS alert or medical incident reported on the gym floor.",
		severity: AlertSeverity.Critical,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 1 },
			{ role: "admin", afterMinutes: 3 },
		],
		sound: "siren",
	},
	[AlertType.LeadUnclaimed]: {
		alertType: AlertType.LeadUnclaimed,
		title: "Unclaimed Callback Lead",
		description: "High-intent app purchase or callback inquiry awaiting response.",
		severity: AlertSeverity.Warning,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 15 },
			{ role: "admin", afterMinutes: 45 },
		],
		sound: "chime",
	},
	[AlertType.CapacityBreached]: {
		alertType: AlertType.CapacityBreached,
		title: "Class Capacity Exceeded",
		description: "Group session capacity limit reached or overbooked waitlist.",
		severity: AlertSeverity.Warning,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 10 },
		],
		sound: "bell",
	},
	[AlertType.OperationalDisruption]: {
		alertType: AlertType.OperationalDisruption,
		title: "Facility Disruption",
		description: "Studio room unavailable, maintenance issue, or equipment downtime.",
		severity: AlertSeverity.Info,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 30 },
		],
		sound: "chime",
	},
	[AlertType.ManualStaffAlert]: {
		alertType: AlertType.ManualStaffAlert,
		title: "Manual Operational Alert",
		description: "Urgent operational broadcast created directly by staff.",
		severity: AlertSeverity.Warning,
		firstResponderRole: "frontdesk",
		escalationLadder: [
			{ role: "branch_manager", afterMinutes: 10 },
		],
		sound: "bell",
	},
};

/**
 * Returns effective rule for an alert type:
 * Checks DB for customized rule; falls back to sensible default (FX-36.2 & FX-36.3).
 */
export async function getEffectiveAlertRule(alertType: AlertType) {
	const customRule = await AlertRule.findOne({ alertType }).lean();
	if (customRule) {
		return customRule;
	}
	return DEFAULT_ALERT_RULES[alertType] ?? DEFAULT_ALERT_RULES[AlertType.ManualStaffAlert];
}
