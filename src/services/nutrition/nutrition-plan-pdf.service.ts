import type { NutritionActor } from "../../types/nutrition";
import { getPlan } from "./nutrition-assignment.service";
import { NutritionServiceError } from "./nutrition-errors";
import { type PdfDeps, defaultPdfDeps } from "./nutrition-pdf.seam";

// Generates (and "stores") a PDF for an assigned plan, then persists only
// metadata on the plan. With the default Noop renderer this throws a
// BAD_REQUEST before anything is persisted — the structured plan remains
// the single source of truth.
export const generatePlanPdf = async (
	planId: string,
	actor: NutritionActor,
	deps: PdfDeps = defaultPdfDeps,
) => {
	const plan = await getPlan(planId, actor);

	const buffer = await deps.renderer.renderPlanPdf(plan);
	const key = `plans/${plan._id.toString()}/${Date.now()}.pdf`;
	const stored = await deps.storage.put(key, buffer, "application/pdf");

	plan.set({
		hasPdf: true,
		pdfUrl: stored.url,
		pdfStorageKey: stored.key,
		pdfGeneratedAt: new Date(),
	});
	await plan.save();

	return {
		pdfUrl: plan.pdfUrl,
		pdfGeneratedAt: plan.pdfGeneratedAt,
	};
};

export const getPlanPdf = async (
	planId: string,
	actor: NutritionActor,
) => {
	const plan = await getPlan(planId, actor);

	if (!plan.hasPdf || !plan.pdfUrl) {
		throw new NutritionServiceError(
			"NOT_FOUND",
			"No PDF has been generated for this plan",
		);
	}

	return {
		pdfUrl: plan.pdfUrl,
		pdfGeneratedAt: plan.pdfGeneratedAt,
	};
};
