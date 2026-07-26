import { createServer } from "node:http";
import { config } from "dotenv";
import mongoose from "mongoose";
import app from "../src/app";
import Class from "../src/models/Class";
import connectDB from "../src/utils/db";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";

config();

const PORT = 3543;
const API_BASE = `http://localhost:${PORT}`;

let server: ReturnType<typeof createServer>;
let adminToken: string;
let userToken: string;

const fetchJson = async (
	path: string,
	options: { method?: string; body?: unknown; token?: string } = {},
) => {
	const url = `${API_BASE}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const res = await fetch(url, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});

	// biome-ignore lint/suspicious/noExplicitAny: test response type
	let data: any = null;
	const text = await res.text();
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}

	return { status: res.status, data };
};

const assert = (condition: boolean, message: string) => {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
	console.log(`  ✅ ${message}`);
};

async function main() {
	console.log("=== Group Class Management API Integration Tests ===");

	// 1. Database Connection
	try {
		await connectDB();
	} catch (err) {
		console.error("DB connection failed", err);
		process.exit(1);
	}

	// 2. Generate test JWT tokens
	const jwtConfig = getJwtConfig();
	if (!jwtConfig) {
		console.error("JWT_SECRET is missing. Cannot sign tokens.");
		process.exit(1);
	}

	adminToken = signAuthToken(
		{ id: "test-admin-id", email: "admin@test.com", role: "admin" },
		jwtConfig,
	);

	userToken = signAuthToken(
		{ id: "test-user-id", email: "user@test.com", role: "user" },
		jwtConfig,
	);

	// 3. Clear database test records
	await Class.deleteMany({});
	console.log("Cleared classes collection.");

	// 4. Start HTTP Server
	server = createServer(app);
	await new Promise<void>((resolve) => {
		server.listen(PORT, () => {
			console.log(`Test server listening on ${API_BASE}`);
			resolve();
		});
	});

	try {
		// --- Test Case 1: Route Protection ---
		console.log("\nRunning Test Case 1: Route Protection...");
		const p1 = await fetchJson("/api/v1/classes");
		assert(p1.status === 401, "GET /classes without token returns 401");

		const p2 = await fetchJson("/api/v1/classes", { token: "invalid-token" });
		assert(p2.status === 401, "GET /classes with invalid token returns 401");

		const p3 = await fetchJson("/api/v1/admin/classes", {
			token: userToken,
			method: "POST",
			body: { name: "Yoga" },
		});
		assert(
			p3.status === 403,
			"POST /admin/classes with user token returns 403",
		);

		// --- Test Case 2: Validation Guards ---
		console.log("\nRunning Test Case 2: Validation Guards...");
		const val1 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "", creditCost: 5 }, // Empty name
		});
		assert(val1.status === 400, "Create fails with 400 when name is empty");

		const val2 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Zumba", creditCost: 0 }, // creditCost < 1
		});
		assert(
			val2.status === 400,
			"Create fails with 400 when creditCost is less than 1",
		);

		const val3 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Zumba", creditCost: -3 }, // Negative creditCost
		});
		assert(
			val3.status === 400,
			"Create fails with 400 when creditCost is negative",
		);

		const val4 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: { name: "Zumba", creditCost: 2.5 }, // Non-integer creditCost
		});
		assert(
			val4.status === 400,
			"Create fails with 400 when creditCost is not an integer",
		);

		// --- Test Case 3: CRUD Create and Read ---
		console.log("\nRunning Test Case 3: CRUD Create and Read...");
		const c1 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Spinning Class",
				description: "High intensity cycling workout",
				creditCost: 3,
			},
		});
		assert(c1.status === 201, "Creates class successfully (201)");
		assert(c1.data.class._id !== undefined, "Class response contains _id");
		assert(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				c1.data.class._id,
			),
			"Class ID is a valid UUID",
		);
		const class1Id = c1.data.class._id;

		// Create a second class, which is inactive
		const c2 = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
			method: "POST",
			body: {
				name: "Yoga Inactive",
				description: "Gentle yoga session",
				creditCost: 2,
				status: "INACTIVE",
			},
		});
		assert(c2.status === 201, "Creates second class successfully (201)");
		const _class2Id = c2.data.class._id;

		// --- Test Case 4: Admin list vs member list (Status Filtering) ---
		console.log("\nRunning Test Case 4: Status Filtering...");
		const listAdmin = await fetchJson("/api/v1/admin/classes", {
			token: adminToken,
		});
		assert(listAdmin.status === 200, "Admin can list all classes");
		assert(
			listAdmin.data.classes.length === 2,
			"Admin list returns both classes",
		);

		const listMember = await fetchJson("/api/v1/classes?status=ACTIVE", {
			token: userToken,
		});
		assert(listMember.status === 200, "Member can list active classes");
		assert(
			listMember.data.classes.length === 1,
			"Member list returns only 1 class",
		);
		assert(
			listMember.data.classes[0]._id === class1Id,
			"Member list only contains the ACTIVE class",
		);

		// Test member list without status query param (should still return active only)
		const listMemberNoQuery = await fetchJson("/api/v1/classes", {
			token: userToken,
		});
		assert(
			listMemberNoQuery.data.classes.length === 1,
			"Member list without query param still returns only active classes",
		);

		// --- Test Case 5: Get Class Details by ID ---
		console.log("\nRunning Test Case 5: Get Class Details by ID...");
		const detail1 = await fetchJson(`/api/v1/classes/${class1Id}`, {
			token: userToken,
		});
		assert(detail1.status === 200, "Retrieve class by ID returns 200");
		assert(
			detail1.data.class.name === "Spinning Class",
			"Retrieves correct class name",
		);

		const detailBadId = await fetchJson("/api/v1/classes/invalid-uuid", {
			token: userToken,
		});
		assert(
			detailBadId.status === 400,
			"Retrieve class with invalid UUID format returns 400",
		);

		const detailMissingId = await fetchJson(
			"/api/v1/classes/00000000-0000-0000-0000-000000000000",
			{ token: userToken },
		);
		assert(
			detailMissingId.status === 404,
			"Retrieve class with missing ID returns 404",
		);

		// --- Test Case 6: Update Class ---
		console.log("\nRunning Test Case 6: Update Class...");
		const update1 = await fetchJson(`/api/v1/admin/classes/${class1Id}`, {
			token: adminToken,
			method: "PUT",
			body: {
				name: "Spinning Class Updated",
				creditCost: 4,
			},
		});
		assert(update1.status === 200, "Update class returns 200");
		assert(
			update1.data.class.name === "Spinning Class Updated",
			"Class name updated successfully",
		);
		assert(
			update1.data.class.creditCost === 4,
			"Class creditCost updated successfully",
		);

		const updateInvalid = await fetchJson(`/api/v1/admin/classes/${class1Id}`, {
			token: adminToken,
			method: "PUT",
			body: {
				creditCost: 0,
			},
		});
		assert(
			updateInvalid.status === 400,
			"Updating creditCost to 0 returns 400",
		);

		// --- Test Case 7: Soft Delete / Retire Class ---
		console.log("\nRunning Test Case 7: Soft Delete / Retire Class...");
		const deleteRes = await fetchJson(`/api/v1/admin/classes/${class1Id}`, {
			token: adminToken,
			method: "DELETE",
		});
		assert(deleteRes.status === 200, "Retire class returns 200");
		assert(
			deleteRes.data.class.status === "INACTIVE",
			"Retired class status is updated to INACTIVE",
		);

		// Check database directly or list classes to ensure it is not returned in member active list
		const listMemberAfterDelete = await fetchJson("/api/v1/classes", {
			token: userToken,
		});
		assert(
			listMemberAfterDelete.data.classes.length === 0,
			"Member list now returns 0 classes after all classes are inactive",
		);

		console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉");
	} finally {
		// Clean up and close connection
		server.close();
		await mongoose.disconnect();
		console.log("Server closed and DB disconnected.");
	}
}

main().catch((err) => {
	console.error("Test execution failed with error:", err);
	if (server) server.close();
	mongoose.disconnect();
	process.exit(1);
});
