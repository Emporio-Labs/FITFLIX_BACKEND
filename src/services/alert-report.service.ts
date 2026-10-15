import mongoose from "mongoose";
import { AlertStatus, AlertType } from "../models/Enums";
import AlertRule from "../models/AlertRule";
import Location from "../models/Location";
import OperationalAlert from "../models/OperationalAlert";
import { DEFAULT_ALERT_RULES } from "../utils/default-alert-rules";

export interface AlertTypeMetrics {
	type: string;
	title: string;
	firedCount: number;
	acknowledgedCount: number;
	breachedCount: number;
	complianceRate: number;
}

export interface PersonPerformanceMetrics {
	userId?: string;
	name: string;
	role: string;
	handledCount: number;
	avgResponseSeconds: number;
	slowestResponseSeconds: number;
	breachCount: number;
}

export interface RolePerformanceMetrics {
	role: string;
	handledCount: number;
	avgResponseSeconds: number;
	slowestResponseSeconds: number;
	breachCount: number;
}

export interface EscalationMilestone {
	role: string;
	afterMinutes: number;
	scheduledAt: string;
	escalated: boolean;
}

export interface AlertBreachItem {
	id: string;
	type: string;
	title: string;
	severity: string;
	branch: {
		id: string;
		name: string;
		code: string;
	};
	createdAt: string;
	slaMinutes: number;
	slaBreachedAt: string;
	status: string;
	acknowledgedBy?: {
		userId?: string;
		name?: string;
		role?: string;
	};
	acknowledgedAt?: string;
	responseSeconds?: number;
	escalationLadder: EscalationMilestone[];
	fullEscalationTrail: string[];
}

export interface AlertReportResponse {
	dateRange: {
		startDate: string;
		endDate: string;
	};
	branch?: {
		id: string;
		name: string;
	};
	summary: {
		totalFired: number;
		totalAcknowledged: number;
		totalBreached: number;
		overallComplianceRate: number;
		avgResponseSeconds: number;
		slowestResponseSeconds: number;
	};
	byType: AlertTypeMetrics[];
	byPerson: PersonPerformanceMetrics[];
	byRole: RolePerformanceMetrics[];
	breaches: AlertBreachItem[];
}

export interface GetAlertReportOptions {
	startDate?: Date | string;
	endDate?: Date | string;
	branchId?: string | mongoose.Types.ObjectId;
	now?: Date;
}

/**
 * FX-44: Calculates Alert SLA and Accountability Reports.
 * - FX-44.1: Alerts fired, acknowledged, and breached by type.
 * - FX-44.2: Average and slowest time to acknowledge, per person and per role.
 * - FX-44.3: Breaches with full escalation history.
 */
export async function getAlertSlaReport(
	options: GetAlertReportOptions = {},
): Promise<AlertReportResponse> {
	const now = options.now ?? new Date();

	// Default date range: last 30 days up to end of today
	const end = options.endDate ? new Date(options.endDate) : new Date(now);
	const start = options.startDate
		? new Date(options.startDate)
		: new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

	const filter: Record<string, unknown> = {
		createdAt: { $gte: start, $lte: end },
	};

	let branchInfo: { id: string; name: string } | undefined;
	if (options.branchId && mongoose.Types.ObjectId.isValid(options.branchId.toString())) {
		const bId = new mongoose.Types.ObjectId(options.branchId.toString());
		filter.branchId = bId;
		const loc = await Location.findById(bId).select("name code").lean();
		if (loc) {
			branchInfo = { id: loc._id.toString(), name: loc.name };
		}
	}

	// 1. Fetch rules map for SLA determination (gracePeriodMinutes / escalation thresholds)
	const customRules = await AlertRule.find({}).lean();
	const rulesMap = new Map<string, { gracePeriodMinutes: number; escalationLadder: Array<{ role: string; afterMinutes: number }> }>();

	for (const cr of customRules) {
		rulesMap.set(cr.alertType, {
			gracePeriodMinutes: cr.gracePeriodMinutes ?? 2,
			escalationLadder: cr.escalationLadder || [],
		});
	}

	// 2. Query alerts populated with branch
	const alerts = await OperationalAlert.find(filter)
		.populate("branchId", "name code")
		.sort({ createdAt: -1 })
		.lean();

	// 3. Track metrics
	const typeStatsMap = new Map<
		string,
		{ fired: number; acknowledged: number; breached: number; title: string }
	>();
	const personStatsMap = new Map<
		string,
		{ name: string; role: string; userId?: string; times: number[]; breaches: number }
	>();
	const roleStatsMap = new Map<
		string,
		{ role: string; times: number[]; breaches: number }
	>();

	const breachesList: AlertBreachItem[] = [];
	let totalFired = alerts.length;
	let totalAcknowledged = 0;
	let totalBreached = 0;
	const allResponseTimes: number[] = [];

	for (const alert of alerts) {
		const type = alert.type as AlertType;
		const rule = rulesMap.get(type) || DEFAULT_ALERT_RULES[type] || {
			gracePeriodMinutes: 2,
			escalationLadder: [],
		};

		// SLA Limit in minutes: first escalation step or rule gracePeriod
		const slaMinutes =
			alert.escalationLadder && alert.escalationLadder.length > 0
				? alert.escalationLadder[0].afterMinutes
				: (rule.gracePeriodMinutes ?? 2);

		const createdAt = new Date(alert.createdAt);
		const acknowledgedAt = alert.acknowledgedAt ? new Date(alert.acknowledgedAt) : undefined;
		const isAcknowledged =
			acknowledgedAt != null ||
			alert.status === AlertStatus.Acknowledged ||
			alert.status === AlertStatus.Resolved;

		let responseSeconds: number | undefined;
		if (acknowledgedAt) {
			responseSeconds = Math.max(0, Math.round((acknowledgedAt.getTime() - createdAt.getTime()) / 1000));
			allResponseTimes.push(responseSeconds);
			totalAcknowledged++;
		}

		// Breach condition:
		// - If acknowledged: acknowledgedAt > createdAt + slaMinutes
		// - If unacknowledged: now > createdAt + slaMinutes
		const slaLimitMs = slaMinutes * 60 * 1000;
		const isBreached = acknowledgedAt
			? acknowledgedAt.getTime() - createdAt.getTime() > slaLimitMs
			: now.getTime() - createdAt.getTime() > slaLimitMs;

		if (isBreached) {
			totalBreached++;
		}

		// Group by Type (FX-44.1)
		const typeTitle = (DEFAULT_ALERT_RULES[type]?.title) || alert.title || type;
		if (!typeStatsMap.has(type)) {
			typeStatsMap.set(type, {
				fired: 0,
				acknowledged: 0,
				breached: 0,
				title: typeTitle,
			});
		}
		const typeStat = typeStatsMap.get(type)!;
		typeStat.fired++;
		if (isAcknowledged) typeStat.acknowledged++;
		if (isBreached) typeStat.breached++;

		// Group by Person and Role (FX-44.2)
		if (alert.acknowledgedBy && responseSeconds !== undefined) {
			const personKey = alert.acknowledgedBy.userId
				? alert.acknowledgedBy.userId.toString()
				: alert.acknowledgedBy.name || "Unknown Staff";
			const personName = alert.acknowledgedBy.name || "Staff";
			const personRole = alert.acknowledgedBy.role || "staff";

			if (!personStatsMap.has(personKey)) {
				personStatsMap.set(personKey, {
					name: personName,
					role: personRole,
					userId: alert.acknowledgedBy.userId?.toString(),
					times: [],
					breaches: 0,
				});
			}
			const pStat = personStatsMap.get(personKey)!;
			pStat.times.push(responseSeconds);
			if (isBreached) pStat.breaches++;

			// By Role
			const roleKey = personRole.toLowerCase();
			if (!roleStatsMap.has(roleKey)) {
				roleStatsMap.set(roleKey, {
					role: personRole,
					times: [],
					breaches: 0,
				});
			}
			const rStat = roleStatsMap.get(roleKey)!;
			rStat.times.push(responseSeconds);
			if (isBreached) rStat.breaches++;
		}

		// Escalation History & Breach Log (FX-44.3)
		if (isBreached) {
			const branchObj =
				typeof alert.branchId === "object" && alert.branchId !== null
					? (alert.branchId as any)
					: { _id: alert.branchId?.toString(), name: "Branch", code: "branch" };

			const ladder = alert.escalationLadder && alert.escalationLadder.length > 0
				? alert.escalationLadder
				: (rule.escalationLadder || []);

			const milestones: EscalationMilestone[] = [];
			const auditTrail: string[] = [];

			const firedTimeStr = createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
			auditTrail.push(
				`[${firedTimeStr}] Alert fired. Initial responders: ${(alert.targetRoles || ["frontdesk"]).join(", ")}. SLA threshold: ${slaMinutes}m.`,
			);

			for (const step of ladder) {
				const milestoneMs = createdAt.getTime() + step.afterMinutes * 60_000;
				const milestoneDate = new Date(milestoneMs);
				const milestoneTimeStr = milestoneDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

				const reached = acknowledgedAt
					? acknowledgedAt.getTime() > milestoneMs
					: now.getTime() >= milestoneMs;

				milestones.push({
					role: step.role,
					afterMinutes: step.afterMinutes,
					scheduledAt: milestoneDate.toISOString(),
					escalated: reached,
				});

				if (reached) {
					auditTrail.push(
						`[${milestoneTimeStr}] SLA breached (+${step.afterMinutes}m). Escalated alert to ${step.role}.`,
					);
				} else if (acknowledgedAt) {
					const ackTimeStr = acknowledgedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
					auditTrail.push(
						`[${ackTimeStr}] Acknowledged before milestone (+${step.afterMinutes}m). Escalation to ${step.role} stopped.`,
					);
				}
			}

			if (acknowledgedAt && alert.acknowledgedBy) {
				const ackTimeStr = acknowledgedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
				const delayMin = Math.round((acknowledgedAt.getTime() - createdAt.getTime()) / 60_000);
				auditTrail.push(
					`[${ackTimeStr}] Acknowledged by ${alert.acknowledgedBy.name} (${alert.acknowledgedBy.role}) after ${delayMin} minutes.`,
				);
			} else {
				auditTrail.push(
					`Currently UNRESOLVED and awaiting acknowledgment (${Math.round((now.getTime() - createdAt.getTime()) / 60_000)}m elapsed).`,
				);
			}

			breachesList.push({
				id: alert._id.toString(),
				type: alert.type,
				title: alert.title,
				severity: alert.severity,
				branch: {
					id: branchObj._id?.toString() || "",
					name: branchObj.name || "Club",
					code: branchObj.code || "",
				},
				createdAt: createdAt.toISOString(),
				slaMinutes,
				slaBreachedAt: new Date(createdAt.getTime() + slaLimitMs).toISOString(),
				status: alert.status,
				acknowledgedBy: alert.acknowledgedBy
					? {
							userId: alert.acknowledgedBy.userId?.toString(),
							name: alert.acknowledgedBy.name,
							role: alert.acknowledgedBy.role,
						}
					: undefined,
				acknowledgedAt: acknowledgedAt?.toISOString(),
				responseSeconds,
				escalationLadder: milestones,
				fullEscalationTrail: auditTrail,
			});
		}
	}

	// Calculate summary rates & averages
	const avgResponseSeconds =
		allResponseTimes.length > 0
			? Math.round(allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length)
			: 0;
	const slowestResponseSeconds =
		allResponseTimes.length > 0 ? Math.max(...allResponseTimes) : 0;
	const overallComplianceRate =
		totalFired > 0
			? Math.round(((totalFired - totalBreached) / totalFired) * 1000) / 10
			: 100;

	// By Type array
	const byType: AlertTypeMetrics[] = Array.from(typeStatsMap.entries()).map(
		([type, stat]) => ({
			type,
			title: stat.title,
			firedCount: stat.fired,
			acknowledgedCount: stat.acknowledged,
			breachedCount: stat.breached,
			complianceRate:
				stat.fired > 0
					? Math.round(((stat.fired - stat.breached) / stat.fired) * 1000) / 10
					: 100,
		}),
	);

	// By Person array (FX-44.2)
	const byPerson: PersonPerformanceMetrics[] = Array.from(personStatsMap.values()).map(
		(stat) => {
			const count = stat.times.length;
			const avg = count > 0 ? Math.round(stat.times.reduce((a, b) => a + b, 0) / count) : 0;
			const slowest = count > 0 ? Math.max(...stat.times) : 0;
			return {
				userId: stat.userId,
				name: stat.name,
				role: stat.role,
				handledCount: count,
				avgResponseSeconds: avg,
				slowestResponseSeconds: slowest,
				breachCount: stat.breaches,
			};
		},
	);
	// Sort by handled count descending
	byPerson.sort((a, b) => b.handledCount - a.handledCount);

	// By Role array (FX-44.2)
	const byRole: RolePerformanceMetrics[] = Array.from(roleStatsMap.values()).map(
		(stat) => {
			const count = stat.times.length;
			const avg = count > 0 ? Math.round(stat.times.reduce((a, b) => a + b, 0) / count) : 0;
			const slowest = count > 0 ? Math.max(...stat.times) : 0;
			return {
				role: stat.role,
				handledCount: count,
				avgResponseSeconds: avg,
				slowestResponseSeconds: slowest,
				breachCount: stat.breaches,
			};
		},
	);
	byRole.sort((a, b) => b.handledCount - a.handledCount);

	return {
		dateRange: {
			startDate: start.toISOString(),
			endDate: end.toISOString(),
		},
		branch: branchInfo,
		summary: {
			totalFired,
			totalAcknowledged,
			totalBreached,
			overallComplianceRate,
			avgResponseSeconds,
			slowestResponseSeconds,
		},
		byType,
		byPerson,
		byRole,
		breaches: breachesList,
	};
}

/**
 * FX-44.4: Formats report data as a multi-table CSV spreadsheet.
 */
export function generateAlertReportCsv(report: AlertReportResponse): string {
	const lines: string[] = [];

	const formatDuration = (seconds: number) => {
		if (seconds < 60) return `${seconds}s`;
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}m ${s}s`;
	};

	const escapeCsv = (val: unknown) => {
		const str = String(val ?? "").replace(/"/g, '""');
		return `"${str}"`;
	};

	// Metadata
	lines.push("FITFLIX OPERATIONAL ALERTS & SLA ACCOUNTABILITY REPORT");
	lines.push(`Date Range,${report.dateRange.startDate} to ${report.dateRange.endDate}`);
	lines.push(`Branch,${report.branch ? report.branch.name : "All Branches"}`);
	lines.push("");

	// Overall Summary
	lines.push("OVERALL SUMMARY");
	lines.push("Total Fired,Total Acknowledged,Total Breached,SLA Compliance Rate,Average Response Time,Slowest Response Time");
	lines.push([
		report.summary.totalFired,
		report.summary.totalAcknowledged,
		report.summary.totalBreached,
		`${report.summary.overallComplianceRate}%`,
		formatDuration(report.summary.avgResponseSeconds),
		formatDuration(report.summary.slowestResponseSeconds),
	].map(escapeCsv).join(","));
	lines.push("");

	// Table 1: By Alert Type (FX-44.1)
	lines.push("ALERTS BY TYPE (FX-44.1)");
	lines.push("Alert Type,Title,Fired,Acknowledged,Breached,SLA Compliance Rate");
	for (const t of report.byType) {
		lines.push([
			t.type,
			t.title,
			t.firedCount,
			t.acknowledgedCount,
			t.breachedCount,
			`${t.complianceRate}%`,
		].map(escapeCsv).join(","));
	}
	lines.push("");

	// Table 2: By Person (FX-44.2)
	lines.push("PERFORMANCE PER PERSON (FX-44.2)");
	lines.push("Staff Name,Role,Handled Alerts,Average Response Time,Slowest Response Time,Breaches");
	for (const p of report.byPerson) {
		lines.push([
			p.name,
			p.role,
			p.handledCount,
			formatDuration(p.avgResponseSeconds),
			formatDuration(p.slowestResponseSeconds),
			p.breachCount,
		].map(escapeCsv).join(","));
	}
	lines.push("");

	// Table 3: By Role (FX-44.2)
	lines.push("PERFORMANCE PER ROLE (FX-44.2)");
	lines.push("Role,Handled Alerts,Average Response Time,Slowest Response Time,Breaches");
	for (const r of report.byRole) {
		lines.push([
			r.role,
			r.handledCount,
			formatDuration(r.avgResponseSeconds),
			formatDuration(r.slowestResponseSeconds),
			r.breachCount,
		].map(escapeCsv).join(","));
	}
	lines.push("");

	// Table 4: Breach Audit Log with Full Escalation History (FX-44.3)
	lines.push("BREACHED ALERTS & ESCALATION AUDIT LOG (FX-44.3)");
	lines.push("Alert ID,Type,Title,Branch,Fired At,SLA Limit (min),Status,Acknowledged By,Role,Acknowledged At,Response Time,Full Escalation History");
	for (const b of report.breaches) {
		lines.push([
			b.id,
			b.type,
			b.title,
			b.branch.name,
			b.createdAt,
			b.slaMinutes,
			b.status,
			b.acknowledgedBy?.name || "Unacknowledged",
			b.acknowledgedBy?.role || "-",
			b.acknowledgedAt || "-",
			b.responseSeconds !== undefined ? formatDuration(b.responseSeconds) : "Unresolved",
			b.fullEscalationTrail.join(" | "),
		].map(escapeCsv).join(","));
	}

	return lines.join("\r\n");
}
