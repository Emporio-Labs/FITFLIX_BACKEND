import mongoose from "mongoose";
import User from "../src/models/User";
import {
	allocatePlanCredits,
	consumeCreditsAtomic,
	getUserCreditBalance,
} from "../src/utils/credit.service";
import {
	assert,
	fetchJson,
	generateTestToken,
	startTestServer,
} from "./test-helpers";

async function runFeature013Tests() {
	console.log("=== Feature Test: FEATURE-013 Credits Engine ===");
	const { baseUrl, close } = await startTestServer();

	let testUserId = "";
	let testToken = "";

	try {
		console.log("\n1. Creating test User account...");
		const testUser = await User.create({
			username: "credits_test_user",
			email: "credits.user@fitflix.test",
			phone: "+12345678999",
			gender: "Male",
			age: 26,
			passwordHash: "hash123",
			firstName: "Credits",
			lastName: "Tester",
			role: "user",
			status: "ACTIVE",
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		testUserId = testUser._id.toString();
		testToken = generateTestToken("user", testUserId);

		console.log("\n2. Testing Plan Auto-Allocation (CREDIT Entry)...");
		const planRefId = new mongoose.Types.ObjectId().toString();
		const allocation = await allocatePlanCredits({
			userId: testUserId,
			creditAmount: 50,
			reason: "PLAN_ASSIGNMENT",
			referenceId: planRefId,
		});
		assert(allocation.success === true, "Plan credits allocated successfully");
		assert(allocation.creditsRemaining === 50, "User credits balance is 50");

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
			ledgerRes.data.transactions[0].sourceId === planRefId,
			"Ledger transaction contains matching Reference ID",
		);

		console.log(
			"\n4. Testing Insufficient Credits Guard (402 Payment Required)...",
		);
		const insufficientRes = await consumeCreditsAtomic({
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
			consumeCreditsAtomic({
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
