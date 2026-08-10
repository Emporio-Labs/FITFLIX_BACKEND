import { communityConfig } from "../../config/community";
import Post from "../../models/Post";
import Share from "../../models/Share";

/** Canonical public URL for a post — returned so the client can share it. */
export function publicShareUrl(postId: string): string {
	return `${communityConfig.publicBaseUrl}/community/posts/${postId}`;
}

/**
 * Record a share event and bump share_count. A share is an EVENT, not a state:
 * repeated shares by the same user each count (unlike likes). Public-only is
 * enforced by the caller via the post:share policy.
 */
export async function sharePost(
	postId: string,
	userId: string,
	channel: string,
): Promise<{ shareUrl: string; shareCount: number }> {
	await new Share({ userId, postId, channel }).save();
	const updated = await Post.findByIdAndUpdate(
		postId,
		{ $inc: { shareCount: 1 } },
		{ returnDocument: "after" },
	)
		.select("shareCount")
		.lean<{ shareCount?: number } | null>();

	return {
		shareUrl: publicShareUrl(postId),
		shareCount: updated?.shareCount ?? 0,
	};
}
