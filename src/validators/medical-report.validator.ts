import { z } from "zod";
import { MedicalReportCategory } from "../models/Enums";

export const memberReportUploadBodySchema = z.object({
	reportName: z.string().trim().min(1, "Report name is required").max(200),
	reportType: z.string().trim().min(1, "Report type is required").max(100),
});

export const dnaReportUploadBodySchema = z.object({
	reportName: z.string().trim().min(1, "Report name is required").max(200),
});

export const listReportsQuerySchema = z.object({
	category: z.nativeEnum(MedicalReportCategory).optional(),
});

export type MemberReportUploadBody = z.infer<
	typeof memberReportUploadBodySchema
>;
export type DnaReportUploadBody = z.infer<typeof dnaReportUploadBodySchema>;
