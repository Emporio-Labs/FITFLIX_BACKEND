import type { UserNutritionPlanDocument } from "../../models/nutrition-plan.model";
import { NutritionServiceError } from "./nutrition-errors";

// ---- Interface seams (DEFERRED) ----
// Real implementations (pdfkit + S3/R2) drop in later with zero changes to
// controllers or the plan-pdf service. PDFs are NEVER the source of truth —
// they are rendered from the structured plan on demand.

export interface PdfRenderer {
	renderPlanPdf(plan: UserNutritionPlanDocument): Promise<Buffer>;
}

export interface StorageProvider {
	put(
		key: string,
		data: Buffer,
		contentType: string,
	): Promise<{ url: string; key: string }>;
	getUrl(key: string): Promise<string>;
}

// Default renderer: explicitly not enabled. Surfaces as a clean 400 rather
// than a crash until a real renderer is wired in.
export class NoopPdfRenderer implements PdfRenderer {
	async renderPlanPdf(): Promise<Buffer> {
		throw new NutritionServiceError(
			"BAD_REQUEST",
			"PDF generation is not yet enabled",
		);
	}
}

// Default storage: deterministic stub keys/URLs, no I/O. Lets the metadata
// wiring be exercised before object storage exists.
export class LocalStorageProvider implements StorageProvider {
	async put(
		key: string,
		_data: Buffer,
		_contentType: string,
	): Promise<{ url: string; key: string }> {
		return { url: `local://nutrition/${key}`, key };
	}

	async getUrl(key: string): Promise<string> {
		return `local://nutrition/${key}`;
	}
}

export type PdfDeps = {
	renderer: PdfRenderer;
	storage: StorageProvider;
};

export const defaultPdfDeps: PdfDeps = {
	renderer: new NoopPdfRenderer(),
	storage: new LocalStorageProvider(),
};
