import mongoose from "mongoose";
import { ReportStatus } from "../../models/Enums";
import Report from "../../models/Report";

export interface ReportResult {
	id: string;
	status: string;
	created: boolean;
}

/**
 * File a report. One PENDING report per user per target: a repeat attempt
 * returns the existing report (idempotent), never a second row. The partial
 * unique index enforces this at the DB even under a race.
 */
export async function createReport(params: {
	reporterId: string;
	targetType: string;
	targetId: string;
	reason: string;
	note?: string;
}): Promise<ReportResult> {
	const key: Record<string, unknown> = {
		reporterId: params.reporterId,
		targetType: params.targetType,
		targetId: params.targetId,
		status: ReportStatus.Pending,
	};

	const existing = await Report.findOne(key)
		.select("_id status")
		.lean<{ _id: mongoose.Types.ObjectId; status: string } | null>();
	if (existing) {
		return { id: String(existing._id), status: existing.status, created: false };
	}

	try {
		const created = new Report({
			reporterId: params.reporterId,
			targetType: params.targetType,
			targetId: params.targetId,
			reason: params.reason,
			note: params.note ?? "",
			status: ReportStatus.Pending,
		});
		await created.save();
		return {
			id: String(created._id),
			status: String(created.status),
			created: true,
		};
	} catch (error) {
		// Lost a race against a concurrent identical report — return the winner.
		if ((error as { code?: number }).code === 11000) {
			const raced = await Report.findOne(key)
				.select("_id status")
				.lean<{ _id: mongoose.Types.ObjectId; status: string } | null>();
			if (raced) {
				return { id: String(raced._id), status: raced.status, created: false };
			}
		}
		throw error;
	}
}
