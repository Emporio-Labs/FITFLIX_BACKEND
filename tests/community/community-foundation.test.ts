import { config } from "dotenv";
import mongoose from "mongoose";
import {
	CommunityRole,
	Gender,
	LikeTargetType,
	MembershipStatus,
	ModerationActionType,
	ModerationTargetType,
	PostVisibility,
	UserStatus,
} from "../../src/models/Enums";
import Like from "../../src/models/Like";
import Membership from "../../src/models/Membership";
import ModerationAction from "../../src/models/ModerationAction";
import PostVersion from "../../src/models/PostVersion";
import User from "../../src/models/User";
import { can } from "../../src/services/community/policy";
import { resolveCommunityUser } from "../../src/services/community/roleResolver";
import type { AuthenticatedUser } from "../../src/types/auth";
import { APPEND_ONLY_ERROR } from "../../src/utils/mongoose-append-only";

config();

// ────────────────────────────────────────────────────────────────────────────
// Harness
// ────────────────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
	if (cond) {
		passed++;
		console.log(`  PASS  ${name}`);
	} else {
		failed++;
		console.log(`  FAIL  ${name}`);
	}
}

async function expectAppendOnlyThrow(
	name: string,
	fn: () => Promise<unknown>,
): Promise<void> {
	try {
		await fn();
		check(`${name} (expected rejection, but write SUCCEEDED)`, false);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const ok = message.includes(APPEND_ONLY_ERROR);
		check(`${name} → rejected: ${message}`, ok);
	}
}

function section(title: string): void {
	console.log(`\n── ${title} ──`);
}

/** Isolated test DB: never touch the real data. */
function toTestDbUrl(url: string): string {
	const parts = url.split("?");
	const base = parts[0] ?? url;
	const query = parts[1];
	const schemeIdx = base.indexOf("://");
	const afterScheme = base.slice(schemeIdx + 3);
	const slashIdx = afterScheme.indexOf("/");
	const hostPart = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
	const dbPart = slashIdx === -1 ? "" : afterScheme.slice(slashIdx + 1);
	const baseDb = dbPart.length > 0 ? dbPart : "fitflix";
	const rebuilt = `${base.slice(0, schemeIdx + 3)}${hostPart}/${baseDb}_community_test`;
	return query ? `${rebuilt}?${query}` : rebuilt;
}

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────
let counter = 0;
async function createUser(status: UserStatus = UserStatus.Active) {
	counter += 1;
	return User.create({
		username: `ctest-${counter}`,
		phone: `900000${String(counter).padStart(4, "0")}`,
		age: 30,
		gender: Gender.Male,
		status,
	});
}

async function createMembership(
	userId: mongoose.Types.ObjectId,
	opts: { status: MembershipStatus; endDate: Date },
) {
	return Membership.create({
		user: userId,
		planName: "Test Plan",
		price: 100,
		status: opts.status,
		startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
		endDate: opts.endDate,
	});
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const asAuth = (id: string, role: AuthenticatedUser["role"]): AuthenticatedUser => ({
	id,
	email: "",
	role,
});

// ────────────────────────────────────────────────────────────────────────────
// Suite
// ────────────────────────────────────────────────────────────────────────────
async function run(): Promise<void> {
	const rawUrl = process.env.MONGODB_TEST_URL || process.env.MONGODB_URL;
	if (!rawUrl) {
		throw new Error("MONGODB_URL is not configured in .env");
	}
	const testUrl = process.env.MONGODB_TEST_URL
		? rawUrl
		: toTestDbUrl(rawUrl);

	await mongoose.connect(testUrl);
	console.log(`Connected to test DB: ${mongoose.connection.name}`);
	// Clean slate.
	await mongoose.connection.dropDatabase();
	await Promise.all([
		User.syncIndexes(),
		Membership.syncIndexes(),
		Like.syncIndexes(),
		PostVersion.syncIndexes(),
		ModerationAction.syncIndexes(),
	]);

	// ── Role derivation (all four roles) ────────────────────────────────────
	section("Role derivation");

	const adminResolved = await resolveCommunityUser(asAuth("admin-id", "admin"));
	check(
		"admin token → admin role",
		adminResolved.role === CommunityRole.Admin,
	);

	const trainerResolved = await resolveCommunityUser(
		asAuth("trainer-id", "trainer"),
	);
	check(
		"trainer token → trainer role",
		trainerResolved.role === CommunityRole.Trainer,
	);

	const insiderUser = await createUser();
	await createMembership(insiderUser._id, {
		status: MembershipStatus.Active,
		endDate: daysFromNow(30),
	});
	const insiderResolved = await resolveCommunityUser(
		asAuth(insiderUser._id.toString(), "user"),
	);
	check(
		"user + active membership → insider",
		insiderResolved.role === CommunityRole.Insider,
	);

	const outsiderUser = await createUser();
	const outsiderResolved = await resolveCommunityUser(
		asAuth(outsiderUser._id.toString(), "user"),
	);
	check(
		"user + no membership → outsider",
		outsiderResolved.role === CommunityRole.Outsider,
	);

	// Membership that expired yesterday MUST resolve to outsider.
	const expiredUser = await createUser();
	await createMembership(expiredUser._id, {
		status: MembershipStatus.Active,
		endDate: daysFromNow(-1),
	});
	const expiredResolved = await resolveCommunityUser(
		asAuth(expiredUser._id.toString(), "user"),
	);
	check(
		"user + membership expired yesterday → outsider",
		expiredResolved.role === CommunityRole.Outsider,
	);

	// ── Suspended / banned users are denied writes ──────────────────────────
	section("Suspended & banned users denied writes");

	const suspendedUser = await createUser(UserStatus.Suspended);
	await createMembership(suspendedUser._id, {
		status: MembershipStatus.Active,
		endDate: daysFromNow(30),
	});
	const suspended = await resolveCommunityUser(
		asAuth(suspendedUser._id.toString(), "user"),
	);
	check("suspended user status resolved", suspended.status === UserStatus.Suspended);
	check("suspended cannot create", can(suspended, "post:create") === false);
	check("suspended cannot comment", can(suspended, "post:comment") === false);
	check("suspended cannot like", can(suspended, "post:like") === false);
	check("suspended cannot share", can(suspended, "post:share") === false);

	const bannedUser = await createUser(UserStatus.Banned);
	const banned = await resolveCommunityUser(
		asAuth(bannedUser._id.toString(), "user"),
	);
	check("banned user status resolved", banned.status === UserStatus.Banned);
	check("banned cannot create", can(banned, "post:create") === false);
	check("banned cannot like", can(banned, "post:like") === false);
	check("banned cannot share", can(banned, "post:share") === false);

	// ── Outsider capabilities ───────────────────────────────────────────────
	section("Outsider capabilities");

	const outsider = outsiderResolved;
	check("outsider cannot create post", can(outsider, "post:create") === false);
	check("outsider cannot comment", can(outsider, "post:comment") === false);
	check("outsider CAN like", can(outsider, "post:like") === true);
	check("outsider CAN share", can(outsider, "post:share") === true);

	const membersOnlyPost = {
		authorId: insiderUser._id.toString(),
		visibility: PostVisibility.MembersOnly,
	};
	const publicPost = {
		authorId: insiderUser._id.toString(),
		visibility: PostVisibility.Public,
	};
	check(
		"outsider cannot view members_only post",
		can(outsider, "post:view", membersOnlyPost) === false,
	);
	check(
		"outsider CAN view public post",
		can(outsider, "post:view", publicPost) === true,
	);
	check(
		"insider CAN view members_only post",
		can(insiderResolved, "post:view", membersOnlyPost) === true,
	);

	// ── Edit ownership ──────────────────────────────────────────────────────
	section("Edit ownership");

	const authorPost = { authorId: insiderUser._id.toString(), visibility: PostVisibility.Public };
	const otherInsider = await createUser();
	await createMembership(otherInsider._id, {
		status: MembershipStatus.Active,
		endDate: daysFromNow(30),
	});
	const otherInsiderResolved = await resolveCommunityUser(
		asAuth(otherInsider._id.toString(), "user"),
	);
	check(
		"insider cannot edit another user's post",
		can(otherInsiderResolved, "post:edit", authorPost) === false,
	);
	check(
		"author CAN edit own post",
		can(insiderResolved, "post:edit", authorPost) === true,
	);
	check(
		"admin CAN edit another user's post",
		can(adminResolved, "post:edit", authorPost) === true,
	);

	// ── Repost is admin-only ────────────────────────────────────────────────
	section("Repost (admin only)");
	check("insider cannot repost", can(insiderResolved, "post:repost") === false);
	check("trainer cannot repost", can(trainerResolved, "post:repost") === false);
	check("admin CAN repost", can(adminResolved, "post:repost") === true);

	// ── History view (author or admin, read-only) ───────────────────────────
	section("History view");
	check(
		"author CAN view own history",
		can(insiderResolved, "history:view", authorPost) === true,
	);
	check(
		"other insider cannot view author's history",
		can(otherInsiderResolved, "history:view", authorPost) === false,
	);
	check(
		"admin CAN read another user's history",
		can(adminResolved, "history:view", authorPost) === true,
	);

	// ── Duplicate like rejected by the DB unique constraint ─────────────────
	section("Duplicate like → DB unique constraint");
	const likeTarget = new mongoose.Types.ObjectId();
	await Like.create({
		userId: insiderUser._id,
		targetType: LikeTargetType.Post,
		targetId: likeTarget,
	});
	try {
		await Like.create({
			userId: insiderUser._id,
			targetType: LikeTargetType.Post,
			targetId: likeTarget,
		});
		check("duplicate like (expected E11000, but INSERT succeeded)", false);
	} catch (error) {
		const code = (error as { code?: number }).code;
		check(`duplicate like rejected by DB (code ${code})`, code === 11000);
	}

	// ── Append-only: post_versions ──────────────────────────────────────────
	section("Append-only enforcement — post_versions");
	const version = await PostVersion.create({
		postId: new mongoose.Types.ObjectId(),
		editedBy: insiderUser._id,
		contentSnapshot: "v1",
	});
	check("post_version insert allowed", Boolean(version._id));
	await expectAppendOnlyThrow("post_versions Model.updateOne", () =>
		PostVersion.updateOne({ _id: version._id }, { contentSnapshot: "hacked" }),
	);
	await expectAppendOnlyThrow("post_versions findOneAndUpdate", () =>
		PostVersion.findOneAndUpdate({ _id: version._id }, { contentSnapshot: "x" }),
	);
	await expectAppendOnlyThrow("post_versions Model.deleteOne", () =>
		PostVersion.deleteOne({ _id: version._id }),
	);
	await expectAppendOnlyThrow("post_versions deleteMany", () =>
		PostVersion.deleteMany({ _id: version._id }),
	);
	await expectAppendOnlyThrow("post_versions doc.save() update", async () => {
		version.contentSnapshot = "tampered";
		await version.save();
	});
	const versionStill = await PostVersion.findById(version._id).lean();
	check(
		"post_version content unchanged after blocked writes",
		versionStill?.contentSnapshot === "v1",
	);

	// ── Append-only: moderation_actions ─────────────────────────────────────
	section("Append-only enforcement — moderation_actions");
	const action = await ModerationAction.create({
		adminId: new mongoose.Types.ObjectId(),
		action: ModerationActionType.Hide,
		targetType: ModerationTargetType.Post,
		targetId: new mongoose.Types.ObjectId(),
		reason: "spam",
	});
	check("moderation_action insert allowed", Boolean(action._id));
	await expectAppendOnlyThrow("moderation_actions Model.updateOne", () =>
		ModerationAction.updateOne({ _id: action._id }, { reason: "changed" }),
	);
	await expectAppendOnlyThrow("moderation_actions Model.deleteOne", () =>
		ModerationAction.deleteOne({ _id: action._id }),
	);
	await expectAppendOnlyThrow("moderation_actions findOneAndDelete", () =>
		ModerationAction.findOneAndDelete({ _id: action._id }),
	);

	// Admin can READ history but the log itself is immutable to everyone — no
	// history:edit/delete action exists, and the DB rejects the write.
	check(
		"admin can read history (policy)",
		can(adminResolved, "history:view", authorPost) === true,
	);
	await expectAppendOnlyThrow(
		"even admin/app cannot modify moderation log",
		() => ModerationAction.updateOne({ _id: action._id }, { reason: "admin-edit" }),
	);
}

async function main(): Promise<void> {
	console.log(
		"================================================================================",
	);
	console.log(
		"        FITFLIX COMMUNITY — FOUNDATION TESTS (role / policy / append-only)       ",
	);
	console.log(
		"================================================================================",
	);

	try {
		await run();
	} catch (error) {
		console.error("\n[CRITICAL ERROR]", error);
		failed++;
	} finally {
		try {
			await mongoose.connection.dropDatabase();
		} catch {
			// best-effort cleanup
		}
		await mongoose.disconnect();
	}

	console.log(
		"\n================================================================================",
	);
	console.log(`RESULT: ${failed === 0 ? "PASS" : "FAIL"}  (passed=${passed}, failed=${failed})`);
	console.log(
		"================================================================================",
	);
	process.exit(failed === 0 ? 0 : 1);
}

main();
