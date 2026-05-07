import type { Request, Response } from "express";
import { Router } from "express";
import mongoose from "mongoose";
import HpodMetric from "../models/HpodMetric";
import { HpodReport } from "../models/Hpodreport.model";
import { authenticateToken } from "../middleware/jwt-auth.middleware";
import { authorize } from "../middleware/rbac.middleware";
import { verifyWebhookSecret } from "../middleware/webhook-auth.middleware";
import {
	fetchEmailById,
	getMessageIdsFromHistory,
} from "../utils/email.service";
import { generateHpodSummary, type HpodSummary } from "../utils/llm.service";

const router = Router();

const ALLOWED_SENDER = "noreply@hpod.in";

const extractEmail = (sender: string): string => {
	const match = sender.match(/<(.+?)>/);
	return match?.[1] ?? sender.trim();
};

const findUserByEmail = async (
	email: string,
): Promise<mongoose.Types.ObjectId | null> => {
	const db = mongoose.connection.db;
	if (!db) return null;
	const user = await db
		.collection("users")
		.findOne({ email }, { projection: { _id: 1 } });
	return user ? user._id : null;
};

const resolveRecordedAt = (
	reportDate: string | null,
	fallback: Date,
): Date => {
	if (!reportDate) return fallback;
	const parsed = new Date(reportDate);
	return Number.isNaN(parsed.getTime()) ? fallback : parsed;
};

const buildHpodMetricPayload = (
	summary: HpodSummary,
	options: {
		userId: mongoose.Types.ObjectId;
		reportId: mongoose.Types.ObjectId;
		gmailMessageId: string;
		receivedAt: Date;
	},
) => ({
	userId: options.userId,
	reportId: options.reportId,
	gmailMessageId: options.gmailMessageId,
	reportDate: summary.reportDate ?? null,
	recordedAt: resolveRecordedAt(summary.reportDate ?? null, options.receivedAt),
	receivedAt: options.receivedAt,
	patientName: summary.patientName ?? null,
	patientEmail: summary.patientEmail ?? null,
	patientPhone: summary.patientPhone ?? null,
	age: summary.age ?? null,
	gender: summary.gender ?? null,
	vitals: {
		weight_kg: summary.vitals.weight_kg ?? null,
		height_cm: summary.vitals.height_cm ?? null,
		bmi: summary.vitals.bmi ?? null,
		bmi_category: summary.vitals.bmi_category ?? null,
		spo2_percent: summary.vitals.spo2_percent ?? null,
		body_temperature_f: summary.vitals.body_temperature_f ?? null,
		pulse: summary.vitals.pulse ?? null,
		blood_pressure: summary.vitals.blood_pressure ?? null,
	},
	bodyComposition: {
		body_fat_mass_kg: summary.bodyComposition.body_fat_mass_kg ?? null,
		body_fat_percent: summary.bodyComposition.body_fat_percent ?? null,
		total_body_water_L: summary.bodyComposition.total_body_water_L ?? null,
		protein_kg: summary.bodyComposition.protein_kg ?? null,
		minerals_kg: summary.bodyComposition.minerals_kg ?? null,
		skeletal_muscle_mass_kg:
			summary.bodyComposition.skeletal_muscle_mass_kg ?? null,
		visceral_fat_cm2: summary.bodyComposition.visceral_fat_cm2 ?? null,
		basal_metabolic_rate_cal:
			summary.bodyComposition.basal_metabolic_rate_cal ?? null,
		intracellular_water_L:
			summary.bodyComposition.intracellular_water_L ?? null,
		extracellular_water_L:
			summary.bodyComposition.extracellular_water_L ?? null,
	},
	ecg: {
		pr_interval: summary.ecg.pr_interval ?? null,
		qrs_interval: summary.ecg.qrs_interval ?? null,
		qtc_interval: summary.ecg.qtc_interval ?? null,
		heart_rate: summary.ecg.heart_rate ?? null,
	},
	idealBodyWeight_kg: summary.idealBodyWeight_kg ?? null,
	weightToLose_kg: summary.weightToLose_kg ?? null,
	testsNotTaken: summary.testsNotTaken ?? [],
	healthInsight: summary.healthInsight ?? "",
	concerns: summary.concerns ?? [],
	source: "hpod",
});

router.post("/email", verifyWebhookSecret, async (req: Request, res: Response) => {
	try {
		const message = req.body?.message;
		if (!message?.data) {
			return res.status(400).json({ error: "No message data" });
		}

		const decoded = Buffer.from(message.data, "base64").toString("utf-8");
		const notification = JSON.parse(decoded);
		const historyId: string = notification.historyId;

		if (!historyId) {
			return res.status(200).json({ status: "no historyId" });
		}

		const messageIds = await getMessageIdsFromHistory(historyId);
		console.log(`Processing ${messageIds.length} new message(s)`);

		for (const msgId of messageIds) {
			const email = await fetchEmailById(msgId);
			if (!email) continue;

			const senderEmail = extractEmail(email.sender);

			// only process emails from hPod
			if (senderEmail.toLowerCase() !== ALLOWED_SENDER) {
				console.log(`Skipped - not from HPOD (${senderEmail})`);
				continue;
			}

			// look up patient by email extracted from PDF
			let userId: mongoose.Types.ObjectId | null = null;
			let userEmail = "unknown";

			if (email.patientEmail) {
				userEmail = email.patientEmail;
				userId = await findUserByEmail(email.patientEmail);
				console.log(
					`Patient email from PDF: ${email.patientEmail} -> userId: ${userId}`,
				);
			} else {
				console.log("No patient email found in PDF");
			}

			// call GPT to extract structured summary from PDF text
			let aiSummary: HpodSummary | null = null;
			let summaryGeneratedAt: Date | null = null;

			if (email.pdfText) {
				console.log("Sending PDF to GPT for summary...");
				aiSummary = await generateHpodSummary(email.pdfText);
				summaryGeneratedAt = aiSummary ? new Date() : null;
				console.log(`Summary generated: ${Boolean(aiSummary)}`);

				// if GPT extracted patient email and we did not get it from regex
				const gptPatientEmail = aiSummary?.patientEmail;
				if (!userId && typeof gptPatientEmail === "string" && gptPatientEmail) {
					userEmail = gptPatientEmail;
					userId = await findUserByEmail(gptPatientEmail);
					console.log(
						`Patient email from GPT: ${gptPatientEmail} -> userId: ${userId}`,
					);
				}
			} else {
				console.log("No PDF text found - skipping LLM");
			}

			// save to MongoDB
			const report = await HpodReport.findOneAndUpdate(
				{ gmailMessageId: email.gmailMessageId },
				{
					$setOnInsert: {
						userId,
						userEmail,
						gmailMessageId: email.gmailMessageId,
						subject: email.subject,
						sender: email.sender,
						rawBody: email.body,
						hasPdf: email.hasPdf,
						aiSummary,
						summaryGeneratedAt,
						receivedAt: new Date(),
					},
				},
				{ upsert: true, returnDocument: "after" },
			);

			if (report && aiSummary && userId) {
				const receivedAt = report.receivedAt ?? new Date();
				const metricPayload = buildHpodMetricPayload(aiSummary, {
					userId,
					reportId: report._id,
					gmailMessageId: email.gmailMessageId,
					receivedAt,
				});

				await HpodMetric.findOneAndUpdate(
					{ gmailMessageId: email.gmailMessageId },
					{ $setOnInsert: metricPayload },
					{ upsert: true },
				);
			}

			console.log(
				`Saved HPOD report - patient: ${userEmail}, userId: ${userId}`,
			);
		}

		return res.status(200).json({ status: "ok", processed: messageIds.length });
	} catch (err) {
		console.error("Webhook error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

router.use(authenticateToken);
router.use(authorize(["admin"]));

// GET /webhook/reports — list all reports (for app to consume)
router.get("/reports", async (_req: Request, res: Response) => {
	const reports = await HpodReport.find()
		.sort({ receivedAt: -1 })
		.select("-rawBody") // exclude heavy field from list view
		.populate("userId", "username email age gender healthGoals");

	return res.json({ reports });
});

// GET /webhook/reports/:id — single report with full body + summary
router.get("/reports/:id", async (req: Request, res: Response) => {
	const report = await HpodReport.findById(req.params.id).populate(
		"userId",
		"username email age gender healthGoals",
	);

	if (!report) return res.status(404).json({ error: "Not found" });
	return res.json(report);
});

// GET /webhook/reports/user/:userId — all reports for a specific user
router.get("/reports/user/:userId", async (req: Request, res: Response) => {
	const reports = await HpodReport.find({ userId: req.params.userId })
		.sort({ receivedAt: -1 })
		.populate("userId", "username email age gender healthGoals");

	return res.json({ reports });
});

export default router;
