import { generateSignedUrl } from "./s3.service";

// Exercise demo images live in a PRIVATE S3 prefix, so the documents store
// object keys (`imageKeys`) rather than fetchable URLs. Every read endpoint
// signs those keys here and projects the result onto `imageUrl` / `imageUrls`,
// which is the shape every existing client already consumes.
//
// Rows with no `imageKeys` (custom exercises, or anything created through the
// API with a plain `imageUrl`) are passed through untouched — signing must
// never clobber a URL somebody set by hand.
//
// This lives in a shared util rather than a controller because several
// endpoints return exercise documents (the catalog, live workout sessions,
// plan/assignment day details). They must SHARE this module's cache: a second
// copy would presign the same key independently and hand out a different query
// string per endpoint, defeating the byte-identical-URL reuse below.
const IMAGE_URL_TTL_SECONDS = Number(
	process.env.EXERCISE_IMAGE_URL_TTL_SECONDS ?? 3600,
);

// A fresh presign produces a different query string every call, so re-signing
// on each request would change every <img src> and force the browser to
// re-download all ~48 frames on a page of results. Cache the signed URL per key
// and reuse it until it is close to expiry, so repeat requests return a byte
// -identical URL and hit the browser cache instead.
const SIGNED_URL_REUSE_MS = Math.max(
	60_000,
	(IMAGE_URL_TTL_SECONDS - 300) * 1000,
);
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

export const signKeyCached = async (key: string): Promise<string | null> => {
	const now = Date.now();
	const hit = signedUrlCache.get(key);
	if (hit && hit.expiresAt > now) return hit.url;

	try {
		const url = await generateSignedUrl(key, IMAGE_URL_TTL_SECONDS, "image/jpeg");
		signedUrlCache.set(key, { url, expiresAt: now + SIGNED_URL_REUSE_MS });
		return url;
	} catch {
		return null;
	}
};

export const withSignedImages = async <T extends Record<string, any>>(
	doc: T,
): Promise<T> => {
	const keys: string[] = Array.isArray(doc.imageKeys) ? doc.imageKeys : [];
	if (keys.length === 0) return doc;

	const signed = await Promise.all(keys.map(signKeyCached));
	const usable = signed.filter((u): u is string => Boolean(u));
	if (usable.length === 0) return doc;

	return { ...doc, imageUrl: usable[0], imageUrls: usable };
};
