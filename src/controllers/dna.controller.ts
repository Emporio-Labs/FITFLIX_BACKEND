import type { Request, RequestHandler, Response } from "express";
import mongoose from "mongoose";
import MedicalReport from "../models/MedicalReport";
import User from "../models/User";
import { validateFileSignature } from "../middleware/upload.middleware";
import { deleteFromS3, generateSignedUrl, uploadStreamToS3 } from "../utils/s3.service";
import type { AuthenticatedUser } from "../types/auth";

interface RequestWithUser extends Request {
	user?: AuthenticatedUser;
	file?: Express.Multer.File;
}

const formatTestItem = async (doc: any) => {
	const obj = doc.toObject ? doc.toObject() : doc;
	let downloadUrl = obj.reportUrl;
	if (obj.s3Key) {
		try {
			downloadUrl = await generateSignedUrl(obj.s3Key, 900, obj.mimeType);
		} catch (err) {
			console.error(`[S3_URL_ERROR] Could not sign key ${obj.s3Key}:`, err);
		}
	}

	return {
		id: obj._id.toString(),
		_id: obj._id.toString(),
		memberId: obj.userId?._id?.toString() || obj.userId?.toString() || "",
		member: obj.userId && typeof obj.userId === "object" ? {
			id: obj.userId._id?.toString(),
			_id: obj.userId._id?.toString(),
			username: obj.userId.username,
			email: obj.userId.email,
			phone: obj.userId.phone,
		} : undefined,
		reportName: obj.reportName || "DNA Analysis Report",
		reportType: obj.reportType || "DNA",
		testDate: obj.testDate ? new Date(obj.testDate).toISOString().split("T")[0] : (obj.uploadedAt ? new Date(obj.uploadedAt).toISOString().split("T")[0] : ""),
		status: obj.status || "completed",
		notes: obj.notes || "",
		s3Key: obj.s3Key,
		mimeType: obj.mimeType,
		fileSize: obj.fileSize,
		downloadUrl,
		createdAt: obj.createdAt,
		uploadedAt: obj.uploadedAt,
	};
};

export const getAllDnaTests: RequestHandler = async (req: RequestWithUser, res: Response, next) => {
	try {
		const { search, status } = req.query;

		const filter: Record<string, any> = {
			reportType: { $regex: /dna/i },
		};

		if (status && typeof status === "string" && status.trim() !== "") {
			filter.status = status.trim();
		}

		const reports = await MedicalReport.find(filter)
			.populate("userId", "username email phone")
			.sort({ createdAt: -1 });

		const formatted = await Promise.all(reports.map(formatTestItem));

		// If a search query is provided, filter on member name, phone, email, notes, or test ID
		let filtered = formatted;
		if (search && typeof search === "string" && search.trim() !== "") {
			const q = search.trim().toLowerCase();
			filtered = formatted.filter((item) => {
				const memberName = item.member?.username?.toLowerCase() || "";
				const memberPhone = item.member?.phone?.toLowerCase() || "";
				const memberEmail = item.member?.email?.toLowerCase() || "";
				const notes = item.notes.toLowerCase();
				const reportName = item.reportName.toLowerCase();
				const testId = item.id.toLowerCase();
				const memberId = item.memberId.toLowerCase();

				return (
					memberName.includes(q) ||
					memberPhone.includes(q) ||
					memberEmail.includes(q) ||
					notes.includes(q) ||
					reportName.includes(q) ||
					testId.includes(q) ||
					memberId.includes(q)
				);
			});
		}

		res.status(200).json({
			success: true,
			tests: filtered,
		});
	} catch (error) {
		next(error);
	}
};

export const createDnaTest: RequestHandler = async (req: RequestWithUser, res: Response, next) => {
	let s3Key: string | undefined;
	let wasUploadedToS3 = false;

	try {
		const rawMemberId = req.body?.memberId || req.body?.userId;
		if (!rawMemberId || !mongoose.Types.ObjectId.isValid(String(rawMemberId))) {
			res.status(400).json({
				error: "A valid member must be selected",
				code: "VALIDATION_ERROR",
			});
			return;
		}

		const targetUser = await User.findById(rawMemberId);
		if (!targetUser) {
			res.status(404).json({
				error: "Member not found",
				code: "NOT_FOUND",
			});
			return;
		}

		let mimeType: string | undefined;
		let fileSize: number | undefined;

		if (req.file) {
			const filePath = req.file.path;
			mimeType = req.file.mimetype;
			fileSize = req.file.size;

			const isValidSignature = await validateFileSignature(filePath, mimeType);
			if (!isValidSignature) {
				res.status(400).json({
					error: "Invalid file contents",
					code: "VALIDATION_ERROR",
				});
				return;
			}

			const ext = req.file.originalname.split(".").pop() ?? "pdf";
			const key = `medical-reports/${targetUser._id.toString()}/${Date.now()}-${new mongoose.Types.ObjectId().toString()}.${ext}`;

			const result = await uploadStreamToS3(key, filePath, mimeType, fileSize);
			s3Key = result.s3Key;
			wasUploadedToS3 = true;
		}

		const status = req.body?.status || (s3Key ? "completed" : "in-progress");
		const notes = req.body?.notes || "";
		const testDate = req.body?.testDate ? new Date(req.body.testDate) : new Date();
		const reportName = req.body?.reportName || "DNA Analysis Report";

		const newReport = new MedicalReport({
			userId: targetUser._id,
			reportName,
			reportType: "DNA",
			status,
			notes,
			testDate,
			s3Key,
			mimeType,
			fileSize,
			uploadedAt: new Date(),
		});

		await newReport.save();

		// Mark user's onboarding DNA step completed if sample was collected / completed
		if (status === "completed" || status === "in-progress" || s3Key) {
			await User.updateOne(
				{ _id: targetUser._id },
				{ $set: { "onboardingStatus.dnaSampleCompleted": true } },
			);
		}

		await newReport.populate("userId", "username email phone");
		const formatted = await formatTestItem(newReport);

		res.status(201).json({
			success: true,
			message: "DNA test created successfully",
			test: formatted,
		});
	} catch (error) {
		if (s3Key && wasUploadedToS3) {
			try {
				await deleteFromS3(s3Key);
			} catch (_) {}
		}
		next(error);
	}
};

export const updateDnaTest: RequestHandler = async (req: RequestWithUser, res: Response, next) => {
	const { id } = req.params;
	if (!id || !mongoose.Types.ObjectId.isValid(id)) {
		res.status(400).json({ error: "Invalid test ID", code: "VALIDATION_ERROR" });
		return;
	}

	let s3Key: string | undefined;
	let wasUploadedToS3 = false;

	try {
		const report = await MedicalReport.findById(id);
		if (!report) {
			res.status(404).json({ error: "DNA test not found", code: "NOT_FOUND" });
			return;
		}

		if (req.file) {
			const filePath = req.file.path;
			const mimeType = req.file.mimetype;
			const fileSize = req.file.size;

			const isValidSignature = await validateFileSignature(filePath, mimeType);
			if (!isValidSignature) {
				res.status(400).json({
					error: "Invalid file contents",
					code: "VALIDATION_ERROR",
				});
				return;
			}

			const ext = req.file.originalname.split(".").pop() ?? "pdf";
			const key = `medical-reports/${report.userId.toString()}/${Date.now()}-${new mongoose.Types.ObjectId().toString()}.${ext}`;

			const result = await uploadStreamToS3(key, filePath, mimeType, fileSize);
			s3Key = result.s3Key;
			wasUploadedToS3 = true;

			// If previous S3 object existed, clean it up
			if (report.s3Key) {
				try {
					await deleteFromS3(report.s3Key);
				} catch (_) {}
			}

			report.s3Key = s3Key;
			report.mimeType = mimeType;
			report.fileSize = fileSize;
		}

		if (req.body?.status) {
			report.status = req.body.status;
		}
		if (req.body?.notes !== undefined) {
			report.notes = req.body.notes;
		}
		if (req.body?.testDate) {
			report.testDate = new Date(req.body.testDate);
		}
		if (req.body?.reportName) {
			report.reportName = req.body.reportName;
		}

		await report.save();

		if (report.status === "completed") {
			await User.updateOne(
				{ _id: report.userId },
				{ $set: { "onboardingStatus.dnaSampleCompleted": true } },
			);
		}

		await report.populate("userId", "username email phone");
		const formatted = await formatTestItem(report);

		res.status(200).json({
			success: true,
			message: "DNA test updated successfully",
			test: formatted,
		});
	} catch (error) {
		if (s3Key && wasUploadedToS3) {
			try {
				await deleteFromS3(s3Key);
			} catch (_) {}
		}
		next(error);
	}
};

export const deleteDnaTest: RequestHandler = async (req: RequestWithUser, res: Response, next) => {
	const { id } = req.params;
	if (!id || !mongoose.Types.ObjectId.isValid(id)) {
		res.status(400).json({ error: "Invalid test ID", code: "VALIDATION_ERROR" });
		return;
	}

	try {
		const report = await MedicalReport.findById(id);
		if (!report) {
			res.status(404).json({ error: "DNA test not found", code: "NOT_FOUND" });
			return;
		}

		if (report.s3Key) {
			try {
				await deleteFromS3(report.s3Key);
			} catch (_) {}
		}

		await MedicalReport.deleteOne({ _id: id });

		res.status(200).json({
			success: true,
			message: "DNA test deleted successfully",
		});
	} catch (error) {
		next(error);
	}
};

export const getMyDnaReports: RequestHandler = async (req: RequestWithUser, res: Response, next) => {
	if (!req.user || req.user.role !== "user") {
		res.status(403).json({ error: "Only members can access this endpoint", code: "FORBIDDEN" });
		return;
	}

	try {
		const reports = await MedicalReport.find({
			userId: req.user.id,
			reportType: { $regex: /dna/i },
		}).sort({ uploadedAt: -1, createdAt: -1 });

		const formatted = await Promise.all(reports.map(formatTestItem));

		res.status(200).json({
			success: true,
			reports: formatted,
		});
	} catch (error) {
		next(error);
	}
};
