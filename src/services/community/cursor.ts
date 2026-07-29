/**
 * Opaque, base64url keyset cursor for feed pagination on (createdAt DESC,
 * _id DESC). The client treats it as a black box and echoes it back.
 */
export interface FeedCursor {
	createdAt: string; // ISO timestamp of the last item on the page
	id: string; // hex ObjectId of the last item on the page
}

export function encodeCursor(cursor: FeedCursor): string {
	return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): FeedCursor | null {
	try {
		const parsed = JSON.parse(
			Buffer.from(raw, "base64url").toString("utf8"),
		) as Partial<FeedCursor>;
		if (typeof parsed.createdAt === "string" && typeof parsed.id === "string") {
			// Reject a malformed timestamp early so it can't poison the query.
			if (Number.isNaN(new Date(parsed.createdAt).getTime())) {
				return null;
			}
			return { createdAt: parsed.createdAt, id: parsed.id };
		}
		return null;
	} catch {
		return null;
	}
}
