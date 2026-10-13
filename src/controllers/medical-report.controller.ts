import { promises as fs } from "node:fs";
import type { Request, RequestHandler, Response } from "express";
import mongoose from "mongoose";
import { normalizeRole } from "../middleware/rbac.middleware";
import { validateFileSignature } from "../middleware/upload.middleware";
import { MedicalReportCategory, MedicalReportSource } from "../models/Enums";
import MedicalReport from "../models/MedicalReport";
import User from "../models/User";
import {
	categoryFilter,
	DNA_REPORT_TYPE,
	looksLikeDnaReportType,
	serializeMemberReport,
	signReportUrl,
} from "../utils/medical-report.util";
import { deleteFromS3, uploadStreamToS3 } from "../utils/s3.service";
import {
	dnaReportUploadBodySchema,
	listReportsQuerySchema,
	memberReportUploadBodySchema,
} from "../validators/medical-report.validator";

const REPORT_MIME_TYPE = "application/pdf";

const getValidationDetails = (
	issues: Array<{ path: PropertyKey[]; message: string }>,
) => {
	const details: Record<string, string> = {};

	for (const issue of issues) {
		const field = issue.path.length > 0 ? issue.path.map(String).join(".") : "body";
		if (!details[field]) {
			details[field] = issue.message;
		}
	}

	return details;
};

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const removeTempFile = async (req: Request) => {
	if (!req.file?.path) return;
	try {
		await fs.unlink(req.file.path);
	} catch (unlinkError) {
		console.error(
			`[CLEANUP_ERROR] Failed to unlink temp file at ${req.file.path}:`,
			unlinkError,
		);
	}
};

type StoreReportInput = {
	ownerId: string;
	reportName: string;
	reportType: string;
	category: MedicalReportCategory;
	source: MedicalReportSource;
	uploadedBy: string;
	uploadedByRole: string;
};

/**
 * Checks the uploaded PDF, puts it in S3 and saves the MedicalReport record.
 * Sends the error response itself and returns null when the file is refused
 * or cannot be stored; the S3 object is removed if the record fails to save.
 */
const storeReportFile = async (
	req: Request,
	res: Response,
	input: StoreReportInput,
) => {
	const file = req.file;
	if (!file) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { file: "A PDF file is required" },
		});
		return null;
	}

	if (file.mimetype !== REPORT_MIME_TYPE) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { file: "Only PDF files are supported" },
		});
		return null;
	}

	if (!(await validateFileSignature(file.path, file.mimetype))) {
		console.error(
			`[SECURITY] File signature validation failed for report upload by ${input.uploadedBy}. Expected: ${file.mimetype}`,
		);
		res.status(400).json({
			error: "Invalid file contents",
			code: "VALIDATION_ERROR",
		});
		return null;
	}

	const key = `medical-reports/${input.ownerId}/${Date.now()}-${new mongoose.Types.ObjectId().toString()}.pdf`;
	const { s3Key } = await uploadStreamToS3(
		key,
		file.path,
		file.mimetype,
		file.size,
	);

	try {
		return await MedicalReport.create({
			userId: input.ownerId,
			reportName: input.reportName,
			reportType: input.reportType,
			s3Key,
			mimeType: file.mimetype,
			fileSize: file.size,
			category: input.category,
			source: input.source,
			uploadedBy: input.uploadedBy,
			uploadedByRole: input.uploadedByRole,
		});
	} catch (dbError) {
		// Don't leave a file in the bucket that no record points at.
		await deleteFromS3(s3Key);
		throw dbError;
	}
};

/** POST /users/me/reports — a member files their own report for experts to read. */
export const uploadMyReport: RequestHandler = async (req, res, next) => {
	try {
		const requester = req.user;
		if (!requester || normalizeRole(requester.role) !== "user") {
			res.status(403).json({
				error: "Only members can access this endpoint",
				code: "FORBIDDEN",
			});
			return;
		}

		const parsed = memberReportUploadBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: getValidationDetails(parsed.error.issues),
			});
			return;
		}

		if (looksLikeDnaReportType(parsed.data.reportType)) {
			res.status(403).json({
				error:
					"DNA reports are added by the Fitflix front desk. Choose another report type.",
				code: "FORBIDDEN",
			});
			return;
		}

		const report = await storeReportFile(req, res, {
			ownerId: requester.id,
			reportName: parsed.data.reportName,
			reportType: parsed.data.reportType,
			category: MedicalReportCategory.Medical,
			source: MedicalReportSource.Client,
			uploadedBy: requester.id,
			uploadedByRole: "user",
		});
		if (!report) return;

		res.status(201).json({
			message: "Report uploaded",
			report: await serializeMemberReport(report, "uploadMyReport"),
		});
	} catch (error) {
		next(error);
	} finally {
		await removeTempFile(req);
	}
};

/** POST /users/:id/dna-reports — the front desk files a member's DNA report. */
export const uploadDnaReportForUser: RequestHandler = async (
	req,
	res,
	next,
) => {
	try {
		const requester = req.user;
		const role = requester ? normalizeRole(requester.role) : null;
		if (!requester || (role !== "admin" && role !== "frontdesk")) {
			res.status(403).json({
				error: "Only the front desk can upload DNA reports",
				code: "FORBIDDEN",
			});
			return;
		}

		const userId = getIdParam(req.params.id);
		if (!userId) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: { id: "Invalid user id" },
			});
			return;
		}

		const parsed = dnaReportUploadBodySchema.safeParse(req.body);
		if (!parsed.success) {
			res.status(400).json({
				error: "Validation failed",
				code: "VALIDATION_ERROR",
				details: getValidationDetails(parsed.error.issues),
			});
			return;
		}

		if (!(await User.exists({ _id: userId }))) {
			res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
			return;
		}

		const report = await storeReportFile(req, res, {
			ownerId: userId,
			reportName: parsed.data.reportName,
			reportType: DNA_REPORT_TYPE,
			category: MedicalReportCategory.Dna,
			source: MedicalReportSource.Frontdesk,
			uploadedBy: requester.id,
			uploadedByRole: role,
		});
		if (!report) return;

		const reportObj = report.toObject();
		res.status(201).json({
			message: "DNA report uploaded",
			report: {
				...reportObj,
				reportUrl: await signReportUrl(reportObj, "uploadDnaReportForUser"),
			},
		});
	} catch (error) {
		next(error);
	} finally {
		await removeTempFile(req);
	}
};

/**
 * GET /users/:id/reports — every report on a member's file, for staff. Any
 * staff role may list any member's reports; `?category=dna|medical` narrows it.
 */
export const listUserReports: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.id);
	if (!userId) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id" },
		});
		return;
	}

	const parsedQuery = listReportsQuerySchema.safeParse(req.query);
	if (!parsedQuery.success) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: getValidationDetails(parsedQuery.error.issues),
		});
		return;
	}

	try {
		if (!(await User.exists({ _id: userId }))) {
			res.status(404).json({ error: "User not found", code: "NOT_FOUND" });
			return;
		}

		const reports = await MedicalReport.find({
			userId,
			...categoryFilter(parsedQuery.data.category),
		}).sort({ uploadedAt: -1 });

		res.status(200).json({
			reports: await Promise.all(
				reports.map(async (report) => {
					const r = report.toObject();
					return {
						...r,
						category: r.category ?? MedicalReportCategory.Medical,
						source: r.source ?? MedicalReportSource.Client,
						reportUrl: await signReportUrl(r, "listUserReports"),
					};
				}),
			),
		});
	} catch (error) {
		next(error);
	}
};

/**
 * DELETE /users/:id/dna-reports/:reportId — the front desk withdraws a DNA
 * report it uploaded (wrong member, wrong file). Members' own uploads are not
 * deletable here.
 */
export const deleteDnaReportForUser: RequestHandler = async (
	req,
	res,
	next,
) => {
	const userId = getIdParam(req.params.id);
	const reportId = getIdParam(req.params.reportId);
	if (!userId || !reportId) {
		res.status(400).json({
			error: "Validation failed",
			code: "VALIDATION_ERROR",
			details: { id: "Invalid user id or report id" },
		});
		return;
	}

	try {
		const report = await MedicalReport.findOneAndDelete({
			_id: reportId,
			userId,
			category: MedicalReportCategory.Dna,
		});

		if (!report) {
			res.status(404).json({ error: "DNA report not found", code: "NOT_FOUND" });
			return;
		}

		if (report.s3Key) {
			await deleteFromS3(report.s3Key);
		}

		res.status(200).json({ message: "DNA report deleted" });
	} catch (error) {
		next(error);
	}
};
