import axios from "axios";

const BASE_URL = "http://localhost:3000";

async function runE2ETest() {
	console.log("=== Starting Habits & Goals E2E Test ===");

	// 1. Authenticate as whiskey@gmail.com
	console.log("\n1. Logging in as whiskey@gmail.com...");
	const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
		email: "whiskey@gmail.com",
		password: "whiskey123",
	});

	const token = loginRes.data.token || loginRes.data.accessToken;
	if (!token) throw new Error("Could not acquire auth token");
	console.log("✓ Logged in successfully");

	const authHeaders = { Authorization: `Bearer ${token}` };

	// 2. Fetch today's habits (auto-seeds the 3 defaults)
	console.log("\n2. Calling GET /habits/me/today...");
	const todayRes = await axios.get(`${BASE_URL}/habits/me/today`, {
		headers: authHeaders,
	});

	console.log("Status:", todayRes.status);
	const data = todayRes.data.data;
	console.log("Summary:", data.summary);
	console.log(
		"Habits found:",
		data.habits.map((h: any) => `${h.title} [${h.category}] (Done: ${h.isCompleted})`),
	);

	if (data.habits.length !== 3) {
		throw new Error(`Expected 3 default habits, got ${data.habits.length}`);
	}
	console.log("✓ 3 default longevity habits auto-seeded and returned");

	const firstHabit = data.habits[0];

	// 3. Toggle the first habit (e.g. Morning Metabolic Prime)
	console.log(`\n3. Calling POST /habits/me/toggle for "${firstHabit.title}"...`);
	const toggleRes = await axios.post(
		`${BASE_URL}/habits/me/toggle`,
		{
			habitId: firstHabit.id,
			source: "manual",
		},
		{ headers: authHeaders },
	);

	console.log("Toggle result:", toggleRes.data.result);
	if (!toggleRes.data.result.completed) {
		throw new Error("Expected habit to be completed after first toggle");
	}
	console.log("✓ Habit toggled ON, streak:", toggleRes.data.result.currentStreak);

	// 4. Verify today's status reflects the toggle
	console.log("\n4. Verifying updated GET /habits/me/today...");
	const verifyToday = await axios.get(`${BASE_URL}/habits/me/today`, {
		headers: authHeaders,
	});
	const updatedSummary = verifyToday.data.data.summary;
	console.log("Updated summary:", updatedSummary);
	if (updatedSummary.completedCount < 1) {
		throw new Error("Expected at least 1 completed habit");
	}
	console.log("✓ Today summary accurately reflects 1 completed habit");

	// 5. Test Goals API (auto-seeds default 3 goals)
	console.log("\n5. Calling GET /goals/me...");
	const goalsRes = await axios.get(`${BASE_URL}/goals/me`, {
		headers: authHeaders,
	});
	console.log("Goals found:", goalsRes.data.goals.length);
	for (const g of goalsRes.data.goals) {
		console.log(`- ${g.title} (${g.type}): ${g.currentValue}/${g.targetValue} ${g.unit} [${g.progressPct}%]`);
	}
	if (goalsRes.data.goals.length < 3) {
		throw new Error("Expected at least 3 default goals");
	}
	console.log("✓ 3 default goals verified with progress percentages");

	// 6. Test Curated Catalog API
	console.log("\n6. Calling GET /habits/catalog...");
	const catalogRes = await axios.get(`${BASE_URL}/habits/catalog`, {
		headers: authHeaders,
	});
	console.log("Catalog items count:", catalogRes.data.catalog.length);
	console.log("✓ Longevity catalog retrieved successfully");

	console.log("\n🎉 ALL HABITS & GOALS BACKEND E2E TESTS PASSED!");
}

runE2ETest().catch((err) => {
	console.error("Test failed:", err.response?.data || err.message);
	process.exit(1);
});
