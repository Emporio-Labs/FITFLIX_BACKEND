import {
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runZegocloudFeatureTests() {
	console.log("=== Feature Test: FEATURE-024 ZEGOCLOUD Integration ===");
	const { baseUrl, close } = await startTestServer();

	try {
		console.log("\n1. Testing ZEGOCLOUD Config Retrieval...");
		const configRes = await fetchJson(baseUrl, "/api/v1/zegocloud/config", {
			token: userToken,
		});
		assert(configRes.status === 200, "GET /api/v1/zegocloud/config returns 200");
		assert(
			typeof configRes.data.config.appID === "number",
			"Config contains numeric appID",
		);
		assert(
			typeof configRes.data.config.appSign === "string",
			"Config contains string appSign",
		);

		console.log(
			"\n2. Testing Conference Room Credentials Generation for App Client...",
		);
		const credentialsRes = await fetchJson(
			baseUrl,
			"/api/v1/zegocloud/room-credentials",
			{
				token: userToken,
				method: "POST",
				body: {
					conferenceID: "conference-session-room-101",
					userName: "Jane App User",
				},
			},
		);

		assert(
			credentialsRes.status === 200,
			"POST /api/v1/zegocloud/room-credentials returns 200",
		);
		const { credentials } = credentialsRes.data;
		assert(
			Boolean(credentials.appID) && Boolean(credentials.appSign),
			"Response contains ZEGOCLOUD appID and appSign",
		);
		assert(
			credentials.conferenceID === "conference_session_room_101",
			"conferenceID sanitized to valid ZEGOCLOUD identifier (numbers, letters, _)",
		);
		assert(
			credentials.userName === "Jane App User",
			"userName correctly populated for video conference",
		);

		console.log("\n3. Testing Payload Validation Guards...");
		const invalidRes = await fetchJson(
			baseUrl,
			"/api/v1/zegocloud/room-credentials",
			{
				token: userToken,
				method: "POST",
				body: {},
			},
		);
		assert(
			invalidRes.status === 400,
			"POST /room-credentials without conferenceID returns 400",
		);

		const unauthRes = await fetchJson(
			baseUrl,
			"/api/v1/zegocloud/room-credentials",
			{
				method: "POST",
				body: { conferenceID: "test" },
			},
		);
		assert(
			unauthRes.status === 401,
			"POST /room-credentials without token returns 401",
		);

		console.log(
			"\n🎉 FEATURE-024 ZEGOCLOUD Video Conference Integration Tests Passed!",
		);
	} finally {
		await close();
	}
}

runZegocloudFeatureTests().catch((err) => {
	console.error("ZEGOCLOUD integration test failed:", err);
	process.exit(1);
});
