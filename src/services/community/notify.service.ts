import Comment from "../../models/Comment";
import { NotificationChannel, NotificationKind } from "../../models/Enums";
import Post from "../../models/Post";
import { notify } from "../notification.service";
import { resolveCommunityAuthors } from "./author";
import { getBlockedUserIds } from "./block.service";

/**
 * Community engagement notifications.
 *
 * Everything here is best-effort and fire-and-forget: a like that succeeded
 * must never 500 because the notification could not be built. Callers are
 * expected to `void`/`.catch()` these — the failures are logged, not thrown.
 *
 * Two rules apply to every kind:
 *   - never notify someone about their own action (liking your own post is
 *     not news), and
 *   - never notify across a block, in either direction. A blocked person
 *     poking the notification tray is exactly what blocking is meant to stop.
 */

const IN_APP_AND_PUSH = [
	NotificationChannel.InApp,
	NotificationChannel.Socket,
	NotificationChannel.Push,
];

interface Actor {
	id: string;
	role?: string;
}

/** Display name for the person who acted, falling back to a neutral label. */
async function actorName(actor: Actor): Promise<string> {
	try {
		const map = await resolveCommunityAuthors([
			{ authorId: actor.id, authorRole: actor.role },
		]);
		const name = map.get(String(actor.id))?.name?.trim();
		return name && name.length > 0 ? name : "A Fitflix member";
	} catch {
		return "A Fitflix member";
	}
}

/** Whether [a] and [b] are separated by a block in either direction. */
async function isBlockedBetween(a: string, b: string): Promise<boolean> {
	try {
		const blocked = await getBlockedUserIds(a);
		return blocked.includes(String(b));
	} catch {
		// Fail closed: if we can't prove the two are un-blocked, stay quiet.
		return true;
	}
}

/** Trim a body to a notification-sized preview without cutting mid-word. */
function preview(text: string | undefined, max = 80): string {
	const clean = (text ?? "").replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	const cut = clean.slice(0, max);
	const lastSpace = cut.lastIndexOf(" ");
	return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`;
}

async function deliver(params: {
	recipientId: string;
	actor: Actor;
	kind: NotificationKind;
	title: string;
	body: string;
	data: Record<string, unknown>;
}): Promise<void> {
	const { recipientId, actor } = params;
	if (!recipientId || String(recipientId) === String(actor.id)) return;
	if (await isBlockedBetween(recipientId, actor.id)) return;

	await notify({
		userId: String(recipientId),
		kind: params.kind,
		title: params.title,
		body: params.body,
		data: params.data,
		channels: IN_APP_AND_PUSH,
	});
}

/** Someone liked a post — tell its author. */
export async function notifyPostLiked(
	postId: string,
	actor: Actor,
): Promise<void> {
	try {
		const post = await Post.findById(postId)
			.select("authorId content deletedAt")
			.lean<{ authorId: unknown; content?: string; deletedAt?: Date } | null>();
		if (!post || post.deletedAt) return;

		const name = await actorName(actor);
		await deliver({
			recipientId: String(post.authorId),
			actor,
			kind: NotificationKind.CommunityPostLiked,
			title: `${name} liked your post`,
			body: preview(post.content) || "Your post got a like.",
			data: { postId: String(postId) },
		});
	} catch (err) {
		console.error("[community/notify] post like notification failed", err);
	}
}

/**
 * Someone commented. Notifies the post author; when the comment is a reply, it
 * notifies the parent comment's author instead — being told "X replied to you"
 * is the useful signal, and the post author is spared a second ping for the
 * same event when both roles land on the same person.
 */
export async function notifyCommented(params: {
	postId: string;
	commentId: string;
	parentId?: string | null;
	body?: string;
	actor: Actor;
}): Promise<void> {
	try {
		const { postId, commentId, parentId, actor } = params;
		const post = await Post.findById(postId)
			.select("authorId deletedAt")
			.lean<{ authorId: unknown; deletedAt?: Date } | null>();
		if (!post || post.deletedAt) return;

		const name = await actorName(actor);
		const bodyPreview = preview(params.body) || "Tap to read it.";
		const notified = new Set<string>([String(actor.id)]);

		if (parentId) {
			const parent = await Comment.findById(parentId)
				.select("authorId deletedAt")
				.lean<{ authorId: unknown; deletedAt?: Date } | null>();
			if (parent && !parent.deletedAt) {
				const parentAuthor = String(parent.authorId);
				if (!notified.has(parentAuthor)) {
					notified.add(parentAuthor);
					await deliver({
						recipientId: parentAuthor,
						actor,
						kind: NotificationKind.CommunityCommentReplied,
						title: `${name} replied to your comment`,
						body: bodyPreview,
						data: { postId: String(postId), commentId: String(commentId) },
					});
				}
			}
		}

		const postAuthor = String(post.authorId);
		if (notified.has(postAuthor)) return;
		await deliver({
			recipientId: postAuthor,
			actor,
			kind: NotificationKind.CommunityPostCommented,
			title: `${name} commented on your post`,
			body: bodyPreview,
			data: { postId: String(postId), commentId: String(commentId) },
		});
	} catch (err) {
		console.error("[community/notify] comment notification failed", err);
	}
}
