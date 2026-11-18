/**
 * Daily goals (water, calories, steps) start from 0 each IST day, and every
 * member has a water goal for the Home +250 ml button to save to.
 *
 * Run against a throwaway database only — this drops it when done:
 *   docker run -d --rm -p 127.0.0.1:27018:27017 mongo:7
 *   TEST_MONGODB_URL=mongodb://127.0.0.1:27018/dailygoalstest bun run test:daily-goals
 */
import mongoose from "mongoose";
import { GoalStatus, GoalType } from "../src/models/Enums";
import MemberGoal from "../src/models/MemberGoal";
import User from "../src/models/User";
import { currentValueForToday } from "../src/services/goal.service";
import { fetchJson, generateTestToken, startTestServer } from "./test-helpers";

const url = process.env.TEST_MONGODB_URL ?? "";
if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) {
	console.error(
		"TEST_MONGODB_URL must point at a local throwaway MongoDB. Refusing.",
	);
	process.exit(1);
}
process.env.MONGODB_URL = url;

let failed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
	if (ok) console.log(`  ✅ ${label}`);
	else {
		failed++;
		console.error(`  ❌ ${label}`, detail ?? "");
	}
};

type GoalRow = { id: string; type: string; currentValue: number };

async function main() {
	console.log("\n── Which value counts today (pure rule) ──");
	const today = "2026-11-18";
	check(
		"water logged today counts",
		currentValueForToday(
			{ type: GoalType.Water, currentValue: 750, progressDate: today },
			today,
		) === 750,
	);
	check(
		"water from yesterday reads as 0",
		currentValueForToday(
			{ type: GoalType.Water, currentValue: 1300, progressDate: "2026-11-17" },
			today,
		) === 0,
	);
	check(
		"water never stamped (before this fix) reads as 0",
		currentValueForToday({ type: GoalType.Water, currentValue: 1300 }, today) === 0,
	);
	check(
		"weight is not a daily goal: always its value",
		currentValueForToday(
			{ type: GoalType.Weight, currentValue: 72, progressDate: "2026-01-01" },
			today,
		) === 72,
	);

	await mongoose.connect(url);
	const db = mongoose.connection.db!;
	await db.dropDatabase();
	await Promise.all([User.init(), MemberGoal.init()]);
	const { baseUrl, close } = await startTestServer();

	const newMember = await User.create({
		username: "New Member",
		phone: "+919000000301",
		onboarded: true,
	});
	const token = generateTestToken("user", newMember.id);
	const goals = async (t: string) => {
		const r = await fetchJson(baseUrl, "/api/v1/goals/me", { token: t });
		return (r.data?.goals ?? []) as GoalRow[];
	};

	console.log("\n── Water resets each day ──");
	let mine = await goals(token);
	const waterGoal = mine.find((g) => g.type === GoalType.Water);
	check("a new member gets a water goal", Boolean(waterGoal), mine);
	{
		const r = await fetchJson(baseUrl, `/api/v1/goals/me/${waterGoal!.id}`, {
			method: "PATCH",
			token,
			body: { currentValue: 750 },
		});
		check("+250 ml taps are saved", r.status === 200, r);
	}
	mine = await goals(token);
	check(
		"today's water reads back",
		mine.find((g) => g.type === GoalType.Water)?.currentValue === 750,
		mine,
	);

	// Next morning: the stored 750 belongs to yesterday.
	await MemberGoal.updateOne(
		{ _id: waterGoal!.id },
		{ $set: { progressDate: "2026-01-01" } },
	);
	mine = await goals(token);
	check(
		"the next day starts at 0, not yesterday's 750",
		mine.find((g) => g.type === GoalType.Water)?.currentValue === 0,
		mine,
	);
	const weight = mine.find((g) => g.type === GoalType.Weight);
	check("the weight goal is untouched", (weight?.currentValue ?? 0) > 0, weight);

	console.log("\n── Every member has a water goal ──");
	const olderMember = await User.create({
		username: "Older Member",
		phone: "+919000000302",
		onboarded: true,
	});
	await MemberGoal.create({
		userId: olderMember._id,
		type: GoalType.Weight,
		title: "Target Weight",
		startValue: 80,
		currentValue: 79,
		targetValue: 75,
		unit: "kg",
		status: GoalStatus.Active,
	});
	const older = await goals(generateTestToken("user", olderMember.id));
	check(
		"a member with other goals but no water goal now gets one",
		older.some((g) => g.type === GoalType.Water),
		older,
	);
	check(
		"and keeps their own goals",
		older.some((g) => g.type === GoalType.Weight && g.currentValue === 79),
		older,
	);
	const again = await goals(generateTestToken("user", olderMember.id));
	check(
		"only one water goal, however often Home loads",
		again.filter((g) => g.type === GoalType.Water).length === 1,
		again,
	);

	await close();
	await db.dropDatabase();
	await mongoose.disconnect();
	console.log(
		failed === 0 ? "\nAll daily goal checks passed." : `\n${failed} check(s) FAILED.`,
	);
	process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
