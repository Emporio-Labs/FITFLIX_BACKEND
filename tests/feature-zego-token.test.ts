import {
	assert,
	fetchJson,
	startTestServer,
	userToken,
} from "./test-helpers";

async function runZegoTokenTests() {
	console.log("=== Feature Test: ZEGOCLOUD Token Generation ===");

	// Setup fake ZEGOCLOUD environment variables
	process.env.ZEGO_APP_ID = "12345678";
	process.env.ZEGO_SERVER_SECRET = "12345678901234567890123456789012"; // 32 bytes
	process.env.ZEGO_APP_SIGN = "1234567890123456789012345678901212345678901234567890123456789012"; // 64 hex

	const { baseUrl, close } = await startTestServer();

	try {
		console.log("\n1. Unauthenticated Request...");
		const noToken = await fetchJson(baseUrl, "/api/v1/zego/token", {
			method: "POST",
			body: { conferenceId: "test-room-1" },
		});
		assert(noToken.status === 401, "POST /zego/token without authorization returns 401");

		console.log("\n2. Request with missing conferenceId...");
		const missingRoom = await fetchJson(baseUrl, "/api/v1/zego/token", {
			method: "POST",
			token: userToken,
			body: {},
		});
		assert(missingRoom.status === 400, "POST /zego/token with missing conferenceId returns 400");
		assert(
			missingRoom.data.error.includes("conferenceId is required"),
			"Error message mentions conferenceId is required",
		);

		console.log("\n3. Request with empty conferenceId...");
		const emptyRoom = await fetchJson(baseUrl, "/api/v1/zego/token", {
			method: "POST",
			token: userToken,
			body: { conferenceId: "   " },
		});
		assert(emptyRoom.status === 400, "POST /zego/token with empty conferenceId returns 400");

		console.log("\n4. Request with valid inputs...");
		const successRes = await fetchJson(baseUrl, "/api/v1/zego/token", {
			method: "POST",
			token: userToken,
			body: { conferenceId: "my-test-room-id" },
		});
		assert(successRes.status === 200, "POST /zego/token with valid parameters returns 200");
		assert(typeof successRes.data.token === "string", "Response token is a string");
		assert(successRes.data.token.startsWith("04"), "Response token starts with '04' (Zego Token04 format)");
		assert(typeof successRes.data.expiresAt === "string", "Response contains expiresAt ISO timestamp");
		assert(new Date(successRes.data.expiresAt).getTime() > Date.now(), "Token expiry is in the future");

		console.log("\n🎉 ZEGOCLOUD Token Generation Feature Tests Passed!");
	} finally {
		await close();
	}
}

runZegoTokenTests()
	.then(() => {
		process.exit(0);
	})
	.catch((err) => {
		console.error("Zego token test failed:", err);
		process.exit(1);
	});
