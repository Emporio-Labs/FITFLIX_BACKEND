import mongoose from "mongoose";
import {
	CommunityRole,
	ModerationActionType,
	ModerationTargetType,
	PostStatus,
	ReportStatus,
	UserStatus,
} from "../../models/Enums";
import Comment from "../../models/Comment";
import Membership from "../../models/Membership";
import ModerationAction from "../../models/ModerationAction";
import Post from "../../models/Post";
import PostMedia from "../../models/PostMedia";
import PostVersion from "../../models/PostVersion";
import Report from "../../models/Report";
import User from "../../models/User";
import { generateSignedUrl } from "../../utils/s3.service";
import { withOptionalTransaction } from "../../utils/transaction";
import { authorFor, resolveCommunityAuthors } from "./author";
import type { ImageRef } from "./post.service";

type Session = mongoose.ClientSession | undefined;
const opt = (s: Session) => (s ? { session: s } : {});

/** Insert one immutable audit row — always inside the caller's transaction. */
async function audit(
	session: Session,
	params: {
		adminId: string;
		action: ModerationActionType;
		targetType: ModerationTargetType;
		targetId: string;
		reason?: string;
		metadata?: Record<string, unknown>;
	},
): Promise<void> {
	const row = new ModerationAction({
		adminId: params.adminId,
		action: params.action,
		targetType: params.targetType,
		targetId: params.targetId,
		reason: params.reason ?? "",
		metadata: params.metadata ?? {},
	});
	await row.save(opt(session));
}

export class ReasonRequiredError extends Error {
	status = 400;
	code = "REASON_REQUIRED";
	constructor() {
		super("A reason is required for this action.");
		this.name = "ReasonRequiredError";
	}
}
function requireReason(reason: string | undefined): string {
	const clean = (reason ?? "").trim();
	if (!clean) throw new ReasonRequiredError();
	return clean;
}

// ────────────────────────────────────────────────────────────────────────────
// Post moderation
// ────────────────────────────────────────────────────────────────────────────

export async function adminDeletePost(
	adminId: string,
	postId: string,
	reason: string,
): Promise<boolean> {
	const clean = requireReason(reason);
	return withOptionalTransaction(async (session) => {
		const post = await Post.findOneAndUpdate(
			{ _id: postId, deletedAt: null },
			{ $set: { deletedAt: new Date() } },
			{ returnDocument: "after", ...opt(session) },
		);
		if (!post) return false;
		await audit(session, {
			adminId,
			action: ModerationActionType.Delete,
			targetType: ModerationTargetType.Post,
			targetId: postId,
			reason: clean,
		});
		return true;
	});
}

export async function adminRestorePost(
	adminId: string,
	postId: string,
	reason?: string,
): Promise<boolean> {
	return withOptionalTransaction(async (session) => {
		const post = await Post.findOneAndUpdate(
			{ _id: postId, deletedAt: { $ne: null } },
			{ $set: { deletedAt: null } },
			{ returnDocument: "after", ...opt(session) },
		);
		if (!post) return false;
		await audit(session, {
			adminId,
			action: ModerationActionType.Restore,
			targetType: ModerationTargetType.Post,
			targetId: postId,
			reason: (reason ?? "").trim(),
		});
		return true;
	});
}

/** Pin a post; only one pinned post at a time (unpin others atomically). */
export async function pinPost(adminId: string, postId: string): Promise<boolean> {
	return withOptionalTransaction(async (session) => {
		const post = await Post.findOne({ _id: postId, deletedAt: null }).session(
			session ?? null,
		);
		if (!post) return false;
		await Post.updateMany(
			{ pinnedAt: { $ne: null } },
			{ $set: { pinnedAt: null } },
			opt(session),
		);
		await Post.updateOne(
			{ _id: postId },
			{ $set: { pinnedAt: new Date() } },
			opt(session),
		);
		await audit(session, {
			adminId,
			action: ModerationActionType.Pin,
			targetType: ModerationTargetType.Post,
			targetId: postId,
		});
		return true;
	});
}

export async function unpinPost(
	adminId: string,
	postId: string,
): Promise<boolean> {
	return withOptionalTransaction(async (session) => {
		const post = await Post.findOneAndUpdate(
			{ _id: postId, pinnedAt: { $ne: null } },
			{ $set: { pinnedAt: null } },
			{ returnDocument: "after", ...opt(session) },
		);
		if (!post) return false;
		await audit(session, {
			adminId,
			action: ModerationActionType.Unpin,
			targetType: ModerationTargetType.Post,
			targetId: postId,
		});
		return true;
	});
}

/**
 * Admin edit — writes a post_versions row with the ADMIN as edited_by (visible
 * in the member's own history) and the audit row, ALL in one transaction.
 */
export async function adminEditPost(
	adminId: string,
	postId: string,
	updates: { body?: string; visibility?: string },
	reason?: string,
): Promise<boolean> {
	return withOptionalTransaction(async (session) => {
		const current = await Post.findOne({
			_id: postId,
			deletedAt: null,
		})
			.select("content")
			.session(session ?? null);
		if (!current) return false;

		const newContent =
			updates.body !== undefined
				? updates.body
				: ((current as { content?: string }).content ?? "");

		const version = new PostVersion({
			postId,
			editedBy: adminId,
			contentSnapshot: newContent,
			mediaSnapshot: [],
		});
		await version.save(opt(session));

		const set: Record<string, unknown> = { editedAt: new Date() };
		if (updates.body !== undefined) set.content = updates.body;
		if (updates.visibility !== undefined) set.visibility = updates.visibility;
		await Post.updateOne(
			{ _id: postId },
			{ $set: set },
			{ runValidators: true, ...opt(session) },
		);

		await audit(session, {
			adminId,
			action: ModerationActionType.Edit,
			targetType: ModerationTargetType.Post,
			targetId: postId,
			reason: (reason ?? "").trim(),
		});
		return true;
	});
}

/** Create an official post as the gym account (is_official = true). */
export async function createOfficialPost(
	adminId: string,
	params: { body: string; visibility: string; images: ImageRef[] },
): Promise<string> {
	return withOptionalTransaction(async (session) => {
		const post = new Post({
			authorId: adminId,
			authorRole: CommunityRole.Admin,
			content: params.body,
			visibility: params.visibility,
			status: PostStatus.Published,
			isOfficial: true,
		});
		await post.save(opt(session));

		if (params.images.length > 0) {
			await PostMedia.insertMany(
				params.images.map((img, i) => ({
					postId: post._id,
					kind: "image",
					url: img.url,
					thumbnailUrl: img.thumbnailUrl ?? null,
					blurredUrl: img.blurredUrl ?? null,
					position: img.position ?? i,
				})),
				opt(session),
			);
		}

		await new PostVersion({
			postId: post._id,
			editedBy: adminId,
			contentSnapshot: params.body,
			mediaSnapshot: params.images,
		}).save(opt(session));

		await audit(session, {
			adminId,
			action: ModerationActionType.CreateOfficial,
			targetType: ModerationTargetType.Post,
			targetId: String(post._id),
		});
		return String(post._id);
	});
}

export async function adminDeleteComment(
	adminId: string,
	commentId: string,
	reason: string,
): Promise<boolean> {
	const clean = requireReason(reason);
	return withOptionalTransaction(async (session) => {
		const comment = await Comment.findOne({
			_id: commentId,
			deletedAt: null,
		})
			.select("postId parentId")
			.session(session ?? null)
			.lean<{
				postId: mongoose.Types.ObjectId;
				parentId?: mongoose.Types.ObjectId | null;
			} | null>();
		if (!comment) return false;

		await Comment.updateOne(
			{ _id: commentId },
			{ $set: { deletedAt: new Date() } },
			opt(session),
		);
		await Post.updateOne(
			{ _id: comment.postId },
			{ $inc: { commentCount: -1 } },
			opt(session),
		);
		if (comment.parentId) {
			await Comment.updateOne(
				{ _id: comment.parentId },
				{ $inc: { replyCount: -1 } },
				opt(session),
			);
		}
		await audit(session, {
			adminId,
			action: ModerationActionType.DeleteComment,
			targetType: ModerationTargetType.Comment,
			targetId: commentId,
			reason: clean,
		});
		return true;
	});
}

// ────────────────────────────────────────────────────────────────────────────
// User moderation
// ────────────────────────────────────────────────────────────────────────────

async function setUserStatus(
	adminId: string,
	userId: string,
	action: ModerationActionType,
	set: Record<string, unknown>,
	reason: string | undefined,
	requireReasonFlag: boolean,
	metadata?: Record<string, unknown>,
): Promise<boolean> {
	const clean = requireReasonFlag ? requireReason(reason) : (reason ?? "").trim();
	return withOptionalTransaction(async (session) => {
		const user = await User.findByIdAndUpdate(userId, { $set: set }, {
			returnDocument: "after",
			...opt(session),
		});
		if (!user) return false;
		await audit(session, {
			adminId,
			action,
			targetType: ModerationTargetType.User,
			targetId: userId,
			reason: clean,
			metadata,
		});
		return true;
	});
}

export const suspendUser = (
	adminId: string,
	userId: string,
	until: Date | null,
	reason: string,
) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.Suspend,
		{ status: UserStatus.Suspended, suspendedUntil: until },
		reason,
		true,
		{ suspendedUntil: until },
	);

export const unsuspendUser = (adminId: string, userId: string, reason?: string) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.Unsuspend,
		{ status: UserStatus.Active, suspendedUntil: null },
		reason,
		false,
	);

export const banUser = (adminId: string, userId: string, reason: string) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.Ban,
		{ status: UserStatus.Banned },
		reason,
		true,
	);

export const unbanUser = (adminId: string, userId: string, reason?: string) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.Unban,
		{ status: UserStatus.Active },
		reason,
		false,
	);

export const assignTrainerRole = (
	adminId: string,
	userId: string,
	reason?: string,
) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.RoleAssign,
		{ communityRole: CommunityRole.Trainer },
		reason,
		false,
		{ role: "trainer" },
	);

export const revokeTrainerRole = (
	adminId: string,
	userId: string,
	reason?: string,
) =>
	setUserStatus(
		adminId,
		userId,
		ModerationActionType.RoleRevoke,
		{ communityRole: null },
		reason,
		false,
		{ role: "trainer" },
	);

// ────────────────────────────────────────────────────────────────────────────
// Report queue
// ────────────────────────────────────────────────────────────────────────────

/** Pending reports, OLDEST FIRST (uses the Day-1 partial index), deduped per target. */
export async function listPendingReports() {
	const reports = await Report.find({ status: ReportStatus.Pending })
		.sort({ createdAt: 1 })
		.lean<
			{
				_id: mongoose.Types.ObjectId;
				reporterId: mongoose.Types.ObjectId;
				targetType: string;
				targetId: mongoose.Types.ObjectId;
				reason: string;
				note?: string;
				createdAt: Date;
			}[]
		>();

	// How many distinct users reported each target (dedupe count).
	const counts = new Map<string, number>();
	for (const r of reports) {
		const key = `${r.targetType}:${r.targetId}`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	// Inline the reported content so the admin doesn't go hunting.
	const postIds = reports
		.filter((r) => r.targetType === "post")
		.map((r) => r.targetId);
	const commentIds = reports
		.filter((r) => r.targetType === "comment")
		.map((r) => r.targetId);
	const [posts, comments, reporters] = await Promise.all([
		Post.find({ _id: { $in: postIds } })
			.select("content visibility authorId deletedAt")
			.lean(),
		Comment.find({ _id: { $in: commentIds } })
			.select("body postId authorId deletedAt")
			.lean(),
		User.find({ _id: { $in: reports.map((r) => r.reporterId) } })
			.select("username")
			.lean<{ _id: mongoose.Types.ObjectId; username?: string }[]>(),
	]);
	const postById = new Map(posts.map((p) => [String(p._id), p]));
	const commentById = new Map(comments.map((c) => [String(c._id), c]));
	const reporterById = new Map(
		reporters.map((u) => [String(u._id), u.username ?? null]),
	);

	const now = Date.now();
	return reports.map((r) => ({
		id: String(r._id),
		targetType: r.targetType,
		targetId: String(r.targetId),
		reason: r.reason,
		note: r.note ?? "",
		reporter: reporterById.get(String(r.reporterId)) ?? null,
		reportCount: counts.get(`${r.targetType}:${r.targetId}`) ?? 1,
		ageHours: Math.floor((now - new Date(r.createdAt).getTime()) / 3_600_000),
		createdAt: r.createdAt,
		content:
			r.targetType === "post"
				? postById.get(String(r.targetId)) ?? null
				: r.targetType === "comment"
					? commentById.get(String(r.targetId)) ?? null
					: null,
	}));
}

export type ReportAction =
	| "dismiss"
	| "delete_content"
	| "warn"
	| "suspend"
	| "ban";

export async function resolveReport(
	adminId: string,
	reportId: string,
	action: ReportAction,
	reason: string | undefined,
): Promise<{ ok: boolean; error?: string }> {
	const report = await Report.findById(reportId)
		.lean<
			{
				_id: mongoose.Types.ObjectId;
				targetType: string;
				targetId: mongoose.Types.ObjectId;
				status: string;
			} | null
		>();
	if (!report || report.status !== ReportStatus.Pending) {
		return { ok: false, error: "not_pending" };
	}

	// Resolve the subject user for user-directed actions.
	let subjectUserId: string | null = null;
	if (report.targetType === "user") {
		subjectUserId = String(report.targetId);
	} else if (report.targetType === "post") {
		const p = await Post.findById(report.targetId).select("authorId").lean<{
			authorId: mongoose.Types.ObjectId;
		} | null>();
		subjectUserId = p ? String(p.authorId) : null;
	} else if (report.targetType === "comment") {
		const c = await Comment.findById(report.targetId).select("authorId").lean<{
			authorId: mongoose.Types.ObjectId;
		} | null>();
		subjectUserId = c ? String(c.authorId) : null;
	}

	if ((action === "suspend" || action === "ban") && !subjectUserId) {
		return { ok: false, error: "no_subject" };
	}
	if (action === "suspend" || action === "ban" || action === "delete_content") {
		requireReason(reason);
	}

	return withOptionalTransaction(async (session) => {
		// 1. Perform the action.
		if (action === "delete_content") {
			if (report.targetType === "post") {
				await Post.updateOne(
					{ _id: report.targetId },
					{ $set: { deletedAt: new Date() } },
					opt(session),
				);
			} else if (report.targetType === "comment") {
				await Comment.updateOne(
					{ _id: report.targetId },
					{ $set: { deletedAt: new Date() } },
					opt(session),
				);
			}
		} else if (action === "suspend" && subjectUserId) {
			await User.updateOne(
				{ _id: subjectUserId },
				{ $set: { status: UserStatus.Suspended } },
				opt(session),
			);
		} else if (action === "ban" && subjectUserId) {
			await User.updateOne(
				{ _id: subjectUserId },
				{ $set: { status: UserStatus.Banned } },
				opt(session),
			);
		}

		// 2. Resolve the report.
		await Report.updateOne(
			{ _id: reportId },
			{
				$set: {
					status:
						action === "dismiss"
							? ReportStatus.Dismissed
							: ReportStatus.Resolved,
					resolvedBy: adminId,
					resolvedAt: new Date(),
				},
			},
			opt(session),
		);

		// 3. Audit — in the SAME transaction.
		await audit(session, {
			adminId,
			action:
				action === "dismiss"
					? ModerationActionType.DismissReport
					: ModerationActionType.ResolveReport,
			targetType: ModerationTargetType.Post,
			targetId: reportId,
			reason: (reason ?? "").trim(),
			metadata: { action, reportTargetType: report.targetType, subjectUserId },
		});
		return { ok: true };
	});
}

// ────────────────────────────────────────────────────────────────────────────
// Admin reads (lists / detail)
// ────────────────────────────────────────────────────────────────────────────

export async function getUserModerationDetail(userId: string) {
	const userTargetFilter: Record<string, unknown> = {
		targetType: "user",
		targetId: userId,
	};
	const activeMembershipFilter: Record<string, unknown> = {
		user: userId,
		status: "Active",
	};
	const [user, membership, postCount, commentCount, reportsAgainst, actions] =
		await Promise.all([
			User.findById(userId)
				.select("username phone status suspendedUntil communityRole createdAt")
				.lean(),
			Membership.findOne(activeMembershipFilter)
				.select("planName endDate")
				.lean(),
			Post.countDocuments({ authorId: userId, deletedAt: null }),
			Comment.countDocuments({ authorId: userId, deletedAt: null }),
			Report.countDocuments(userTargetFilter),
			ModerationAction.find(userTargetFilter)
				.sort({ createdAt: -1 })
				.limit(50)
				.lean(),
		]);
	if (!user) return null;
	return {
		user,
		membership,
		postCount,
		commentCount,
		reportsAgainst,
		moderationActions: actions,
	};
}

interface AdminPostLean {
	_id: mongoose.Types.ObjectId;
	authorId: mongoose.Types.ObjectId;
	authorRole?: string;
	content?: string;
	visibility: string;
	status: string;
	isOfficial?: boolean;
	pinnedAt?: Date | null;
	editedAt?: Date | null;
	deletedAt?: Date | null;
	likeCount?: number;
	commentCount?: number;
	shareCount?: number;
	createdAt: Date;
}

/** Browse ALL posts (incl members_only + deleted) with role/visibility/status/reported filters. */
export async function listPostsAdmin(filters: {
	role?: string;
	visibility?: string;
	status?: string;
	deleted?: boolean;
	reported?: boolean;
	limit?: number;
}) {
	const q: Record<string, unknown> = {};
	if (filters.visibility) q.visibility = filters.visibility;
	if (filters.status) q.status = filters.status;
	if (filters.role) q.authorRole = filters.role;
	if (filters.deleted === true) q.deletedAt = { $ne: null };
	else if (filters.deleted === false) q.deletedAt = null;
	if (filters.reported) {
		const reportedFilter: Record<string, unknown> = {
			status: ReportStatus.Pending,
			targetType: "post",
		};
		const ids = await Report.find(reportedFilter).distinct("targetId");
		q._id = { $in: ids };
	}

	const posts = await Post.find(q)
		.sort({ createdAt: -1 })
		.limit(filters.limit ?? 50)
		.lean<AdminPostLean[]>();
	const authorMap = await resolveCommunityAuthors(
		posts.map((p) => ({
			authorId: String(p.authorId),
			authorRole: p.authorRole,
		})),
	);
	return posts.map((p) => ({
		id: String(p._id),
		author: authorFor(
			{ authorId: String(p.authorId), authorRole: p.authorRole },
			authorMap,
		),
		content: p.content ?? "",
		visibility: p.visibility,
		status: p.status,
		isOfficial: Boolean(p.isOfficial),
		pinned: p.pinnedAt != null,
		edited: p.editedAt != null,
		deleted: p.deletedAt != null,
		likeCount: p.likeCount ?? 0,
		commentCount: p.commentCount ?? 0,
		shareCount: p.shareCount ?? 0,
		createdAt: p.createdAt,
	}));
}

/** Full post for admin view — never redacted, includes deleted, signs media. */
export async function getPostAdmin(postId: string) {
	const post = await Post.findById(postId).lean<AdminPostLean | null>();
	if (!post) return null;
	const [authorMap, media] = await Promise.all([
		resolveCommunityAuthors([
			{ authorId: String(post.authorId), authorRole: post.authorRole },
		]),
		PostMedia.find({ postId })
			.sort({ position: 1 })
			.lean<
				{
					_id: mongoose.Types.ObjectId;
					url: string;
					thumbnailUrl?: string | null;
					position?: number;
				}[]
			>(),
	]);
	return {
		id: String(post._id),
		author: authorFor(
			{ authorId: String(post.authorId), authorRole: post.authorRole },
			authorMap,
		),
		content: post.content ?? "",
		visibility: post.visibility,
		status: post.status,
		isOfficial: Boolean(post.isOfficial),
		pinned: post.pinnedAt != null,
		edited: post.editedAt != null,
		deleted: post.deletedAt != null,
		likeCount: post.likeCount ?? 0,
		commentCount: post.commentCount ?? 0,
		shareCount: post.shareCount ?? 0,
		createdAt: post.createdAt,
		media: await Promise.all(
			media.map(async (m) => ({
				id: String(m._id),
				url: await generateSignedUrl(m.url, 900, "image/jpeg"),
				position: m.position ?? 0,
			})),
		),
	};
}

/** Comments for a post INCLUDING soft-deleted ones (admin moderation view). */
export async function listCommentsAdmin(postId: string) {
	const comments = await Comment.find({ postId })
		.sort({ createdAt: 1 })
		.lean<
			{
				_id: mongoose.Types.ObjectId;
				parentId?: mongoose.Types.ObjectId | null;
				authorId: mongoose.Types.ObjectId;
				authorRole?: string;
				body: string;
				deletedAt?: Date | null;
				likeCount?: number;
				createdAt: Date;
			}[]
		>();
	const authorMap = await resolveCommunityAuthors(
		comments.map((c) => ({
			authorId: String(c.authorId),
			authorRole: c.authorRole,
		})),
	);
	return comments.map((c) => ({
		id: String(c._id),
		parentId: c.parentId ? String(c.parentId) : null,
		author: authorFor(
			{ authorId: String(c.authorId), authorRole: c.authorRole },
			authorMap,
		),
		body: c.body,
		deleted: c.deletedAt != null,
		likeCount: c.likeCount ?? 0,
		createdAt: c.createdAt,
	}));
}

/** Users with role/status/membership filters. */
export async function listUsersAdmin(filters: {
	status?: string;
	communityRole?: string;
	limit?: number;
}) {
	const q: Record<string, unknown> = {};
	if (filters.status) q.status = filters.status;
	if (filters.communityRole === "trainer") q.communityRole = "trainer";
	const users = await User.find(q)
		.sort({ createdAt: -1 })
		.limit(filters.limit ?? 50)
		.select("username phone status suspendedUntil communityRole createdAt")
		.lean();
	return users.map((u) => ({
		id: String(u._id),
		username: (u as { username?: string }).username ?? null,
		status: (u as { status?: string }).status ?? "active",
		suspendedUntil: (u as { suspendedUntil?: Date }).suspendedUntil ?? null,
		communityRole: (u as { communityRole?: string }).communityRole ?? null,
		createdAt: (u as { createdAt?: Date }).createdAt ?? null,
	}));
}
