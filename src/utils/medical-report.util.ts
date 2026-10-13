import { MedicalReportCategory, MedicalReportSource } from "../models/Enums";
import { generateSignedUrl } from "./s3.service";

/** How long a report's signed download link stays valid (seconds). */
export const REPORT_URL_TTL_SECONDS = 900;

/** The reportType stamped on every front-desk DNA upload. */
export const DNA_REPORT_TYPE = "DNA";

/**
 * True when a member-typed report type claims to be a DNA report. Members may
 * not file DNA reports — only the front desk can — so their upload is refused
 * rather than stored under a label the DNA hub would never show.
 */
export const looksLikeDnaReportType = (reportType: string): boolean =>
	/\bdna\b|genetic|genom/i.test(reportType);

/**
 * Mongo filter for a report category. Records saved before the field existed
 * have no category and count as medical.
 */
export const categoryFilter = (category?: MedicalReportCategory) => {
	if (!category) return {};
	if (category === MedicalReportCategory.Dna) {
		return { category: MedicalReportCategory.Dna };
	}
	return { category: { $ne: MedicalReportCategory.Dna } };
};

type ReportLike = {
	_id: { toString(): string };
	reportName: string;
	reportType: string;
	s3Key?: string | null;
	mimeType?: string | null;
	category?: string | null;
	source?: string | null;
	uploadedAt?: Date | null;
	createdAt?: Date | null;
};

export const signReportUrl = async (
	report: Pick<ReportLike, "s3Key" | "mimeType">,
	context: string,
): Promise<string | undefined> => {
	if (!report.s3Key) return undefined;
	try {
		return await generateSignedUrl(
			report.s3Key,
			REPORT_URL_TTL_SECONDS,
			report.mimeType,
		);
	} catch (err) {
		console.error(
			`[S3_SIGNING_ERROR] Failed to generate signed URL for key ${report.s3Key} in ${context}:`,
			err,
		);
		return undefined;
	}
};

/**
 * The member-app shape for a report (`GET /users/me/reports` and the upload
 * response). Reports saved before category/source existed read as a member's
 * own medical upload.
 */
export const serializeMemberReport = async (
	report: ReportLike,
	context: string,
) => ({
	id: report._id.toString(),
	title: report.reportName,
	type: report.reportType,
	category: report.category ?? MedicalReportCategory.Medical,
	source: report.source ?? MedicalReportSource.Client,
	summary: `Uploaded ${report.reportType} report`,
	suggestions: [],
	recommendations: [],
	insights: [],
	generated_date: (
		report.uploadedAt ??
		report.createdAt ??
		new Date()
	).toISOString(),
	pdf_url: await signReportUrl(report, context),
});
