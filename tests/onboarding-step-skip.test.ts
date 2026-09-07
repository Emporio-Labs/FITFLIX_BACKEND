import { Gender, OnboardingStep, UserStatus } from "../src/models/Enums";
import User from "../src/models/User";
import { assert, fetchJson, generateTestToken, startTestServer } from "./test-helpers";

/**
 * Covers the generic onboarding step skip (POST /onboarding/steps/:step/skip):
 *   - each skippable step can be deferred: it lands in skippedSteps, moves
 *     currentStep forward, and its completion flag / completedSteps stay
 *     untouched (a skip must never look like a human did the step)
 *   - CONSENT is skippable too (the wizard must never trap a paying member),
 *     but skipping it still leaves it outstanding for the front desk
 *   - POST /onboarding/steps/skip-all defers every remaining step at once
 *   - skipping every skippable step flips appOnboardingCompleted true while
 *     onboardingCompleted (which also needs the centre-owned shared steps)
 *     stays false
 *   - POST /onboarding/complete still refuses with MISSING_STEPS after skips
 *   - a skipped step remains submittable later, which un-skips it and does
 *     not drag currentStep backwards
 *   - a repeated skip is an idempotent 200 no-op
 */
async function runOnboardingStepSkipTests() {
	console.log("=== Feature Test: Onboarding Step Skip ===");
	const { baseUrl, close } = await startTestServer();

	let memberId = "";
	let memberToken = "";

	const makeMember = async (suffix: string) => {
		const member = await User.create({
			username: `skip_member_${suffix}`,
			email: `skip.${suffix}@fitflix.test`,
			phone: `+1234500${suffix.padStart(4, "0")}`,
			gender: Gender.Male,
			age: 27,
			passwordHash: "hash123",
			firstName: "Skip",
			lastName: "Member",
			role: "user",
			status: UserStatus.Active,
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		return member;
	};

	const getStatus = async (token: string) => {
		const res = await fetchJson(baseUrl, "/onboarding/status", { token });
		assert(res.status === 200, "GET /onboarding/status returns 200");
		return res.data as Record<string, any>;
	};

	try {
		console.log("\n1. Creating test member...");
		const member = await makeMember("1");
		memberId = member._id.toString();
		memberToken = generateTestToken("user", memberId);

		console.log("\n2. Skipping HEALTH_MARKERS (the current step)...");
		const skipHealthMarkers = await fetchJson(
			baseUrl,
			"/onboarding/steps/HEALTH_MARKERS/skip",
			{ method: "POST", token: memberToken },
		);
		assert(skipHealthMarkers.status === 200, "Skip returns 200");
		assert(
			skipHealthMarkers.data.status.skippedSteps.includes("HEALTH_MARKERS"),
			"skippedSteps contains HEALTH_MARKERS",
		);
		assert(
			skipHealthMarkers.data.status.currentStep === "HEALTH_GOALS",
			`currentStep advanced to HEALTH_GOALS (got ${skipHealthMarkers.data.status.currentStep})`,
		);
		assert(
			!skipHealthMarkers.data.status.completedSteps.includes("HEALTH_MARKERS"),
			"HEALTH_MARKERS is not in completedSteps — a skip is not a completion",
		);

		console.log("\n3. An unrecognized step is rejected...");
		// Move to CONSENT first via the normal health-goals submission path so
		// currentStep really is CONSENT.
		const healthGoals = await fetchJson(baseUrl, "/onboarding/health-goals", {
			method: "POST",
			token: memberToken,
			body: { goals: ["weight_loss"] },
		});
		assert(healthGoals.status === 201, "Health goals submitted");
		const skipBogus = await fetchJson(baseUrl, "/onboarding/steps/NOT_A_STEP/skip", {
			method: "POST",
			token: memberToken,
		});
		assert(skipBogus.status === 400, "Skipping an unknown step returns 400");
		assert(
			skipBogus.data?.code === "VALIDATION_ERROR",
			"Error code is VALIDATION_ERROR",
		);

		console.log("\n4. Repeated skip is an idempotent 200 no-op...");
		const skipHealthMarkersAgain = await fetchJson(
			baseUrl,
			"/onboarding/steps/HEALTH_MARKERS/skip",
			{ method: "POST", token: memberToken },
		);
		assert(skipHealthMarkersAgain.status === 200, "Repeated skip still returns 200");
		assert(
			skipHealthMarkersAgain.data.status.currentStep === "CONSENT",
			"currentStep did not move again on the repeated skip",
		);

		console.log("\n5. Submitting a previously-skipped step un-skips it...");
		const healthMarkers = await fetchJson(baseUrl, "/onboarding/health-markers", {
			method: "POST",
			token: memberToken,
			body: { weight: 70, height: 175 },
		});
		assert(healthMarkers.status === 201, "HEALTH_MARKERS submits successfully after a skip");
		const statusAfterHealthMarkers = await getStatus(memberToken);
		assert(
			!statusAfterHealthMarkers.skippedSteps.includes("HEALTH_MARKERS"),
			"HEALTH_MARKERS removed from skippedSteps once actually completed",
		);
		assert(
			statusAfterHealthMarkers.completedSteps.includes("HEALTH_MARKERS"),
			"HEALTH_MARKERS now in completedSteps",
		);
		assert(
			statusAfterHealthMarkers.currentStep === "CONSENT",
			`currentStep did not rewind past CONSENT (got ${statusAfterHealthMarkers.currentStep})`,
		);

		console.log("\n6. Skipping every step one by one flips appOnboardingCompleted...");
		const member2 = await makeMember("2");
		const token2 = generateTestToken("user", member2._id.toString());
		const everyStep: OnboardingStep[] = [
			OnboardingStep.HEALTH_MARKERS,
			OnboardingStep.HEALTH_GOALS,
			OnboardingStep.CONSENT,
			OnboardingStep.REPORT_UPLOAD,
			OnboardingStep.SPORT_SCIENTIST_APPOINTMENT,
			OnboardingStep.NUTRITIONIST_BOOKING,
		];
		for (const step of everyStep) {
			const res = await fetchJson(baseUrl, `/onboarding/steps/${step}/skip`, {
				method: "POST",
				token: token2,
			});
			assert(res.status === 200, `Skip ${step} returns 200`);
			if (step === OnboardingStep.NUTRITIONIST_BOOKING) {
				assert(
					res.data.status.appOnboardingCompleted === true,
					"appOnboardingCompleted is true once every app-owned step is done or skipped",
				);
				assert(
					res.data.status.onboardingCompleted === false,
					"onboardingCompleted stays false — centre-owned shared steps are still outstanding",
				);
				assert(
					res.data.status.pendingSteps.includes("CONSENT"),
					"A skipped CONSENT is still reported as pending, not quietly satisfied",
				);
			}
		}

		console.log("\n7. POST /onboarding/steps/skip-all defers everything at once...");
		const member3 = await makeMember("3");
		const token3 = generateTestToken("user", member3._id.toString());
		const skipAll = await fetchJson(baseUrl, "/onboarding/steps/skip-all", {
			method: "POST",
			token: token3,
		});
		assert(skipAll.status === 200, "Skip-all returns 200");
		assert(
			skipAll.data.status.currentStep === "COMPLETED",
			`Skip-all lands the wizard on COMPLETED (got ${skipAll.data.status.currentStep})`,
		);
		assert(
			skipAll.data.status.appOnboardingCompleted === true,
			"Skip-all flips appOnboardingCompleted so the router lets the member in",
		);
		assert(
			skipAll.data.status.onboardingCompleted === false,
			"Skip-all never satisfies full onboarding",
		);
		for (const step of everyStep) {
			assert(
				skipAll.data.status.skippedSteps.includes(step),
				`Skip-all recorded ${step} as skipped`,
			);
			assert(
				!skipAll.data.status.completedSteps.includes(step),
				`Skip-all did not mark ${step} completed`,
			);
		}
		const skipAllAgain = await fetchJson(baseUrl, "/onboarding/steps/skip-all", {
			method: "POST",
			token: token3,
		});
		assert(skipAllAgain.status === 200, "Repeated skip-all is an idempotent no-op");
		await User.findByIdAndDelete(member3._id);

		console.log("\n8. Skip-all leaves already-completed steps alone...");
		const member4 = await makeMember("4");
		const token4 = generateTestToken("user", member4._id.toString());
		const hm4 = await fetchJson(baseUrl, "/onboarding/health-markers", {
			method: "POST",
			token: token4,
			body: { weight: 68, height: 170 },
		});
		assert(hm4.status === 201, "HEALTH_MARKERS completed for real");
		const skipAll4 = await fetchJson(baseUrl, "/onboarding/steps/skip-all", {
			method: "POST",
			token: token4,
		});
		assert(skipAll4.status === 200, "Skip-all returns 200");
		assert(
			!skipAll4.data.status.skippedSteps.includes("HEALTH_MARKERS"),
			"A step already completed is not recorded as skipped",
		);
		assert(
			skipAll4.data.status.completedSteps.includes("HEALTH_MARKERS"),
			"The completed step stays completed",
		);
		await User.findByIdAndDelete(member4._id);

		console.log("\n9. POST /onboarding/complete still refuses with MISSING_STEPS...");
		const completeAttempt = await fetchJson(baseUrl, "/onboarding/complete", {
			method: "POST",
			token: token2,
		});
		assert(completeAttempt.status === 400, "Complete returns 400 after skips");
		assert(
			completeAttempt.data?.code === "MISSING_STEPS",
			"Error code is MISSING_STEPS",
		);

		await User.findByIdAndDelete(member2._id);

		console.log("\n🎉 Onboarding Step Skip Tests Passed!");
	} finally {
		if (memberId) await User.findByIdAndDelete(memberId);
		await close();
	}
}

runOnboardingStepSkipTests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Onboarding step skip test failed:", err);
		process.exit(1);
	});
