import { MICRO_KEYS, type MicroKey } from "../../config/nutrition-micros";
import { nutritionOffConfig } from "../../config/nutrition-off";

export { MICRO_KEYS };

export type ExternalFoodDto = {
	externalSource: "OpenFoodFacts";
	externalId: string;
	name: string;
	brand: string | null;
	barcode: string | null;
	imageUrl: string | null;
	caloriesKcal: number;
	proteinG: number;
	carbsG: number;
	fatG: number;
	fiberG: number | null;
	sugarG: number | null;
	isVeg?: boolean;
	allergens: string[];
	servings: { label: string; gramsPerUnit: number; isDefault: boolean }[];
	micros: Record<string, number>;
};

// OFF nutriments are per-100g, matching NutritionFood.basePer:100 exactly for
// macros. Minerals/vitamins, however, are stored in **grams** regardless of
// their natural unit (e.g. sodium_100g: 0.043 means 43 mg), so every micro
// needs an explicit gram -> target-unit factor here. Getting this wrong
// silently under-reports by 1000x (mg) or 1,000,000x (µg) with no error
// anywhere downstream — verified against a live OFF product before writing
// this table, not assumed.
const MICRO_CONVERSIONS: Record<MicroKey, { offKey: string; factor: number }> =
	{
		sodiumMg: { offKey: "sodium_100g", factor: 1000 },
		potassiumMg: { offKey: "potassium_100g", factor: 1000 },
		calciumMg: { offKey: "calcium_100g", factor: 1000 },
		ironMg: { offKey: "iron_100g", factor: 1000 },
		vitaminAUg: { offKey: "vitamin-a_100g", factor: 1_000_000 },
		vitaminCMg: { offKey: "vitamin-c_100g", factor: 1000 },
		cholesterolMg: { offKey: "cholesterol_100g", factor: 1000 },
		saturatedFatG: { offKey: "saturated-fat_100g", factor: 1 },
	};

// world.openfoodfacts.org/api/v2 returns full nutriments in one call via
// `fields=`. The alternative search.openfoodfacts.org (Search-a-licious)
// index was evaluated and rejected: it only ever returns `code` +
// `product_name` regardless of the `fields` param, which would require an
// extra per-result round trip just to get macros.
const FIELDS = [
	"code",
	"product_name",
	"generic_name",
	"brands",
	"nutriments",
	"serving_quantity",
	"serving_size",
	"ingredients_analysis_tags",
	"allergens_tags",
	"image_url",
].join(",");

type OffProduct = {
	code?: string;
	product_name?: string;
	generic_name?: string;
	brands?: string;
	image_url?: string;
	serving_quantity?: number | string;
	serving_size?: string;
	ingredients_analysis_tags?: string[];
	allergens_tags?: string[];
	// Flat bag of `${key}_100g` fields. Deliberately typed to only the
	// top-level (label-measured) `nutriments` object — `nutriments_estimated`
	// is AI-inferred from ingredients on many real products and must never be
	// imported as if it were factual data.
	nutriments?: Record<string, number>;
};

type OffSearchResponse = { products?: OffProduct[] };
type OffProductResponse = { status?: number; product?: OffProduct };

// Single-process in-memory TTL cache. OFF rate-limits search to ~10 req/min
// and barcode lookup to ~100 req/min per IP; this softens bursts from the
// debounced Flutter search box without a new infra dependency. Moves to
// Redis trivially if the backend is ever scaled horizontally.
class TtlCache<T> {
	private store = new Map<string, { value: T; expiresAt: number }>();

	get(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt < Date.now()) {
			this.store.delete(key);
			return undefined;
		}
		return entry.value;
	}

	set(key: string, value: T, ttlMs: number): void {
		this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
		if (this.store.size > 500) {
			const now = Date.now();
			for (const [k, v] of this.store) {
				if (v.expiresAt < now) this.store.delete(k);
			}
		}
	}
}

const searchCache = new TtlCache<ExternalFoodDto[]>();
const barcodeCache = new TtlCache<ExternalFoodDto | null>();

const offFetch = async (url: string): Promise<unknown> => {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		nutritionOffConfig.requestTimeoutMs,
	);
	try {
		const res = await fetch(url, {
			headers: { "User-Agent": nutritionOffConfig.userAgent },
			signal: controller.signal,
		});
		if (!res.ok) return null;
		return await res.json();
	} catch {
		// Network failure / timeout / OFF outage. External lookup is additive
		// to the local catalog, never load-bearing — callers treat this the
		// same as "no external results" rather than surfacing a 500.
		return null;
	} finally {
		clearTimeout(timeout);
	}
};

const num = (
	nutriments: Record<string, number> | undefined,
	key: string,
): number | null => {
	const v = nutriments?.[key];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const round = (v: number): number => Math.round(v * 100) / 100;

// Maps a raw OFF product into the catalog shape. Returns null when any of
// the four macros required by NutritionFood (calories/protein/carbs/fat) is
// absent — crowdsourced entries missing these are common and must be
// filtered out here rather than persisted with a schema-violating value.
export const mapOffProduct = (product: OffProduct): ExternalFoodDto | null => {
	const code = product.code;
	if (!code) return null;

	const n = product.nutriments;
	const caloriesKcal = num(n, "energy-kcal_100g");
	const proteinG = num(n, "proteins_100g");
	const carbsG = num(n, "carbohydrates_100g");
	const fatG = num(n, "fat_100g");
	if (
		caloriesKcal === null ||
		proteinG === null ||
		carbsG === null ||
		fatG === null
	) {
		return null;
	}

	const name = (product.product_name || product.generic_name || "").trim();
	if (!name) return null;

	const analysisTags = product.ingredients_analysis_tags ?? [];
	let isVeg: boolean | undefined;
	if (analysisTags.includes("en:vegetarian")) isVeg = true;
	else if (analysisTags.includes("en:non-vegetarian")) isVeg = false;
	// "maybe-vegetarian" and vegan-only tags (e.g. en:non-vegan) don't
	// reliably answer the vegetarian question — left undefined (the schema
	// is deliberately tri-state) rather than guessed from an adjacent tag.

	const allergens = (product.allergens_tags ?? []).map((t) =>
		t.replace(/^en:/, ""),
	);

	const servings: ExternalFoodDto["servings"] = [];
	const servingQty = Number(product.serving_quantity);
	if (Number.isFinite(servingQty) && servingQty > 0) {
		servings.push({
			label: product.serving_size?.trim() || `${servingQty} g`,
			gramsPerUnit: servingQty,
			isDefault: true,
		});
	}

	const micros: Record<string, number> = {};
	for (const [key, { offKey, factor }] of Object.entries(MICRO_CONVERSIONS)) {
		const raw = num(n, offKey);
		if (raw !== null) micros[key] = round(raw * factor);
	}

	const fiberRaw = num(n, "fiber_100g");
	const sugarRaw = num(n, "sugars_100g");

	return {
		externalSource: "OpenFoodFacts",
		externalId: code,
		name,
		brand: product.brands?.split(",")[0]?.trim() || null,
		barcode: code,
		imageUrl: product.image_url || null,
		caloriesKcal: round(caloriesKcal),
		proteinG: round(proteinG),
		carbsG: round(carbsG),
		fatG: round(fatG),
		fiberG: fiberRaw !== null ? round(fiberRaw) : null,
		sugarG: sugarRaw !== null ? round(sugarRaw) : null,
		isVeg,
		allergens,
		servings,
		micros,
	};
};

export const searchOff = async (
	query: string,
	page = 1,
	pageSize = nutritionOffConfig.defaultSearchPageSize,
): Promise<ExternalFoodDto[]> => {
	const trimmed = query.trim();
	if (!trimmed) return [];

	const cacheKey = `${trimmed.toLowerCase()}::${page}::${pageSize}`;
	const cached = searchCache.get(cacheKey);
	if (cached) return cached;

	const params = new URLSearchParams({
		search_terms: trimmed,
		search_simple: "1",
		action: "process",
		json: "1",
		page: String(page),
		page_size: String(pageSize),
		fields: FIELDS,
	});

	const json = (await offFetch(
		`${nutritionOffConfig.searchBaseUrl}?${params.toString()}`,
	)) as OffSearchResponse | null;
	if (!json?.products) return [];

	const results = json.products
		.map(mapOffProduct)
		.filter((dto): dto is ExternalFoodDto => dto !== null);

	searchCache.set(cacheKey, results, nutritionOffConfig.searchCacheTtlMs);
	return results;
};

export const lookupOffBarcode = async (
	code: string,
): Promise<ExternalFoodDto | null> => {
	const trimmed = code.trim();
	if (!trimmed) return null;

	const cached = barcodeCache.get(trimmed);
	if (cached !== undefined) return cached;

	const params = new URLSearchParams({ fields: FIELDS });
	const json = (await offFetch(
		`${nutritionOffConfig.baseUrl}/product/${encodeURIComponent(trimmed)}.json?${params.toString()}`,
	)) as OffProductResponse | null;

	const dto =
		json?.status === 1 && json.product ? mapOffProduct(json.product) : null;
	barcodeCache.set(trimmed, dto, nutritionOffConfig.barcodeCacheTtlMs);
	return dto;
};
