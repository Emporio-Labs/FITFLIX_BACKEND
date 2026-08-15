import mongoose from "mongoose";
import { Gender, UserStatus } from "../src/models/Enums";
import User from "../src/models/User";
import Membership from "../src/models/Membership";
import { CreditTransactionSource, MembershipStatus } from "../src/models/Enums";
import {
	CreditServiceError,
	addCreditsToMembership,
	consumeCredits,
	getUserCreditBalance,
	mapCreditServiceError,
} from "../src/utils/credit.service";

import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

/**
 * consumeCredits throws rather than returning a result object (the old
 * consumeCreditsAtomic returned one). Adapt it here so these assertions keep
 * testing behaviour rather than the calling convention.
 */
async function tryConsume(input: {
	userId: string;
	amount: number;
	reason: string;
}): Promise<{ success: boolean; statusCode: number }> {
	try {
		await consumeCredits({
			userId: input.userId,
			amount: input.amount,
			sourceType: CreditTransactionSource.Booking,
			reason: input.reason,
		});
		return { success: true, statusCode: 200 };
	} catch (error) {
		if (error instanceof CreditServiceError) {
			return { success: false, statusCode: mapCreditServiceError(error).status };
		}
		throw error;
	}
}

async function runFeature013Tests() {
	console.log("=== Feature Test: FEATURE-013 Credits Engine ===");
	const { baseUrl, close } = await startTestServer();

	let testUserId = "";
	let testToken = "";
	let testMembershipId = "";

	try {
		console.log("\n1. Creating test User account...");
		const testUser = await User.create({
			username: "credits_test_user",
			email: "credits.user@fitflix.test",
			phone: "+12345678999",
			gender: Gender.Male,
			age: 26,
			passwordHash: "hash123",
			firstName: "Credits",
			lastName: "Tester",
			role: "user",
			status: UserStatus.Active,
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		testUserId = testUser._id.toString();
		testToken = generateTestToken("user", testUserId);

		console.log("\n2. Testing Plan Auto-Allocation (CREDIT Entry)...");
		// Credits attach to a real membership. The removed allocatePlanCredits
		// used to conjure a junk "Default Plan" membership when none existed,
		// which hid the fact that credits without a membership are meaningless.
		const membership = await Membership.create({
			user: new mongoose.Types.ObjectId(testUserId),
			planName: "Credits Engine Test Plan",
			price: 0,
			creditsIncluded: 0,
			creditsRemaining: 0,
			status: MembershipStatus.Active,
			startDate: new Date(Date.now() - 60_000),
			endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
		});
		testMembershipId = membership._id.toString();

		const allocation = await addCreditsToMembership({
			userId: testUserId,
			amount: 50,
			reason: "PLAN_ASSIGNMENT",
			actorRole: "admin",
		});
		assert(
			allocation.creditsRemaining === 50,
			`User credits balance is 50 (Got: ${allocation.creditsRemaining})`,
		);

		console.log(
			"\n3. Testing REST Endpoints (GET /api/v1/credits/balance & GET /api/v1/credits/ledger)...",
		);
		const balanceRes = await fetchJson(baseUrl, "/api/v1/credits/balance", {
			token: testToken,
		});
		assert(
			balanceRes.status === 200,
			"GET /api/v1/credits/balance returns 200 OK",
		);
		assert(
			balanceRes.data.availableCredits === 50,
			"REST balance endpoint returns 50 available credits",
		);

		const ledgerRes = await fetchJson(baseUrl, "/api/v1/credits/ledger", {
			token: testToken,
		});
		assert(
			ledgerRes.status === 200,
			"GET /api/v1/credits/ledger returns 200 OK",
		);
		assert(
			ledgerRes.data.count >= 1,
			"Ledger returns transaction history items",
		);
		assert(
			ledgerRes.data.transactions[0].membership === testMembershipId,
			"Ledger transaction is attributed to the funding membership",
		);

		console.log(
			"\n4. Testing Insufficient Credits Guard (402 Payment Required)...",
		);
		const insufficientRes = await tryConsume({
			userId: testUserId,
			amount: 100, // exceeds 50 available
			reason: "OVERDRAFT_TEST",
		});
		assert(insufficientRes.success === false, "Overdraft debit blocked");
		assert(
			insufficientRes.statusCode === 402,
			"Returns 402 Payment Required for insufficient credits",
		);

		console.log(
			"\n5. Testing Overdraft Prevention (20 Concurrent Debit Attempts for 10 Credits)...",
		);
		const concurrentDebits = Array.from({ length: 20 }, () =>
			tryConsume({
				userId: testUserId,
				amount: 10,
				reason: "CONCURRENT_BOOKING",
			}),
		);

		const debitResults = await Promise.all(concurrentDebits);
		const successfulDebits = debitResults.filter((r) => r.success);
		const failedDebits = debitResults.filter(
			(r) => !r.success && r.statusCode === 402,
		);

		assert(
			successfulDebits.length === 5,
			`Exactly 5 concurrent debits succeeded (5 x 10 = 50 credits) (Got: ${successfulDebits.length})`,
		);
		assert(
			failedDebits.length === 15,
			`Exactly 15 debits failed safely with 402 Payment Required (Got: ${failedDebits.length})`,
		);

		const finalBalance = await getUserCreditBalance(testUserId);
		assert(
			finalBalance.availableCredits === 0,
			"Final credit balance is exactly 0 (Zero overdraft / negative balance occurred)",
		);

		console.log("\n🎉 FEATURE-013 Credits Engine Tests Passed!");
	} finally {
		if (testMembershipId) {
			await Membership.findByIdAndDelete(testMembershipId);
		}
		if (testUserId) {
			await User.findByIdAndDelete(testUserId);
		}
		await close();
	}
}

runFeature013Tests().catch((err) => {
	console.error("Credits engine feature test failed:", err);
	process.exit(1);
});
