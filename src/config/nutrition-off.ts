/**
 * Open Food Facts integration configuration. Every tunable lives here (not
 * hardcoded at the call site) and can be overridden by an environment
 * variable.
 */

const positiveInt = (value: string | undefined, fallback: number): number => {
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const nutritionOffConfig = {
	/**
	 * Product data lives on world.openfoodfacts.org (full nutriments in one
	 * call via `fields=`). The separate search.openfoodfacts.org
	 * (Search-a-licious) index was evaluated and rejected — it only ever
	 * returns `code` + `product_name` regardless of the `fields` param, so it
	 * cannot supply macros without an extra per-result round trip.
	 */
	baseUrl: process.env.OFF_BASE_URL ?? "https://world.openfoodfacts.org/api/v2",

	/**
	 * The v2 `/search` endpoint used above for barcode lookups (`/product/:code`)
	 * does NOT perform full-text search on `search_terms` — verified live:
	 * "sambar", "dal", and "idli" all returned the identical 5 products with
	 * `count` equal to the *entire* OFF database size, i.e. the query is
	 * silently ignored and it just returns its default unfiltered page. Real
	 * text search only works on the legacy CGI endpoint. This is a different
	 * host/path from `baseUrl` (not a version bump of the same API), kept as
	 * its own setting so it can be overridden independently.
	 */
	searchBaseUrl:
		process.env.OFF_SEARCH_BASE_URL ??
		"https://search.openfoodfacts.org/search",

	/** Required by OFF's terms — an anonymous/default UA risks being blocked. */
	userAgent: process.env.OFF_USER_AGENT ?? "Fitflix/1.0 (tech@fitflix.in)",

	requestTimeoutMs: positiveInt(process.env.OFF_REQUEST_TIMEOUT_MS, 8000),

	/** OFF rate-limits search to ~10 req/min per IP — cache softens bursts. */
	searchCacheTtlMs: positiveInt(
		process.env.OFF_SEARCH_CACHE_TTL_MS,
		10 * 60 * 1000,
	),

	/** Barcode lookups are ~100 req/min on OFF and change rarely once cached. */
	barcodeCacheTtlMs: positiveInt(
		process.env.OFF_BARCODE_CACHE_TTL_MS,
		24 * 60 * 60 * 1000,
	),

	defaultSearchPageSize: positiveInt(process.env.OFF_SEARCH_PAGE_SIZE, 20),
};
