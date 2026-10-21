import type { RequestHandler } from "express";
import {
	generateMigrationTemplateBuffer,
	parseAndValidateMigrationWorkbook,
	executeMigrationBatch,
} from "../utils/member-migration-excel";

const XLSX_MIME =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const downloadMigrationTemplate: RequestHandler = async (_req, res, next) => {
	try {
		const buffer = generateMigrationTemplateBuffer();
		res.setHeader("Content-Type", XLSX_MIME);
		res.setHeader(
			"Content-Disposition",
			'attachment; filename="member-migration-template.xlsx"',
		);
		res.setHeader("Content-Length", buffer.length);
		res.status(200).send(buffer);
	} catch (error) {
		next(error);
	}
};

export const previewMigration: RequestHandler = async (req, res, next) => {
	try {
		const file = req.file;
		if (!file || !file.buffer) {
			res.status(400).json({
				error: "Please upload an Excel .xlsx file",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const result = await parseAndValidateMigrationWorkbook(file.buffer);
		res.status(200).json(result);
	} catch (error) {
		next(error);
	}
};

export const executeMigration: RequestHandler = async (req, res, next) => {
	try {
		const file = req.file;
		if (!file || !file.buffer) {
			res.status(400).json({
				error: "Please upload an Excel .xlsx file",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const validation = await parseAndValidateMigrationWorkbook(file.buffer);
		if (!validation.valid) {
			res.status(400).json({
				error: "Excel file validation failed. Please review errors and retry.",
				code: "VALIDATION_ERROR",
				details: validation.errors,
				validation,
			});
			return;
		}

		if (validation.members.length === 0) {
			res.status(400).json({
				error: "No member rows found in the uploaded file",
				code: "EMPTY_DATA",
			});
			return;
		}

		const execution = await executeMigrationBatch(
			validation,
			req.user?.id,
			req.user?.role,
		);

		res.status(execution.success ? 200 : 207).json({
			message: execution.success
				? `Successfully migrated ${execution.summary.importedMembers} members and recorded ${execution.summary.totalSessionsRecorded} sessions.`
				: `Migration completed with some errors.`,
			result: execution,
		});
	} catch (error) {
		next(error);
	}
};
