import mongoose from "mongoose";
import { AlertSeverity, AlertStatus, AlertType } from "../src/models/Enums";
import ClassModel from "../src/models/Class";
import GymVisit from "../src/models/GymVisit";
import Invoice from "../src/models/Invoice";
import Location from "../src/models/Location";
import OperationalAlert from "../src/models/OperationalAlert";
import ScheduledSession from "../src/models/ScheduledSession";
import User from "../src/models/User";
import { getBranchBoardData } from "../src/services/branch-board.service";
import connectDB from "../src/utils/db";
import { assert, fetchJson, generateTestToken, startTestServer } from "./test-helpers";

async function runTests() {
	console.log("\n🧪 Running Multi-Branch Operations Board (FX-43) Tests...");

	await connectDB();

	// 1. Setup mock branch
	let branchA = await Location.findOne({ code: "board_branch_a" });
	if (!branchA) {
		branchA = await Location.create({
			name: "Board Branch A",
			code: "board_branch_a",
			timezone: "Asia/Kolkata",
			isActive: true,
			settings: { currency: "INR" },
		});
	}

	let branchB = await Location.findOne({ code: "board_branch_b" });
	if (!branchB) {
		branchB = await Location.create({
			name: "Board Branch B",
			code: "board_branch_b",
			timezone: "Asia/Kolkata",
			isActive: true,
			settings: { currency: "INR" },
		});
	}

	const branchAId = branchA._id;
	const branchBId = branchB._id;

	// Mock manager user assigned to branch A
	const managerUser = await User.create({
		username: `manager_a_${Date.now()}`,
		email: `manager_a_${Date.now()}@fitflix.test`,
		phone: "+919988776611",
		age: 30,
		gender: "Female",
		homeLocationId: branchAId,
		onboarded: true,
	});

	// Mock regular user
	const regularUser = await User.create({
		username: `user_${Date.now()}`,
		email: `user_${Date.now()}@fitflix.test`,
		phone: "+919988776612",
		age: 25,
		gender: "Male",
		onboarded: true,
	});

	const now = new Date();

	// -------------------------------------------------------------
	// 🔎 FX-43.1: Check that board metrics compute all 5 core elements
	// -------------------------------------------------------------
	console.log("\n🔎 FX-43.1: Board calculates sessions, check-ins, staff, alerts, and revenue");

	// Seed check-in for Branch A
	const visit = await GymVisit.create({
		userId: regularUser._id,
		locationId: branchAId,
		checkInAt: now,
		checkOutAt: null,
	});

	// Seed open operational alert for Branch A
	const alert = await OperationalAlert.create({
		type: AlertType.LeadUnclaimed,
		severity: AlertSeverity.Warning,
		status: AlertStatus.Open,
		title: "Branch A Test Alert",
		message: "Unclaimed lead test",
		branchId: branchAId,
		targetRoles: ["frontdesk"],
		relatedEntity: {
			entityType: "other",
			entityId: "test_entity_123",
		},
	});

	// Seed paid invoice for Branch A
	const invoice = await Invoice.create({
		invoiceNumber: `INV_TEST_${Date.now()}`,
		locationId: branchAId,
		userId: regularUser._id,
		subtotal: 12500,
		total: 12500,
		paymentStatus: "PAID",
		planSnapshot: {
			name: "Annual Protocol",
			durationInDays: 365,
			price: 12500,
			includedCredits: 50,
		},
		items: [
			{
				name: "Annual Protocol",
				price: 12500,
				quantity: 1,
			},
		],
	});

	const boardResult = await getBranchBoardData([branchAId], now);
	assert(boardResult.branches.length === 1, "Board returned 1 branch item");

	const branchMetrics = boardResult.branches[0];
	assert(branchMetrics.branch.id === branchAId.toString(), "Branch ID matches Branch A");
	assert(branchMetrics.checkIns.todayCount >= 1, "Today's check-ins count is recorded");
	assert(branchMetrics.checkIns.currentlyInGym >= 1, "Currently in gym count is recorded");
	assert(branchMetrics.alerts.openCount >= 1, "Open alerts count is recorded");
	assert(branchMetrics.revenue.todayTotal >= 12500, "Today's revenue is calculated from paid invoices");
	assert(branchMetrics.revenue.currency === "INR", "Revenue currency is INR");
	assert(Array.isArray(branchMetrics.sessions.items), "Sessions array is present");

	// -------------------------------------------------------------
	// 🔎 FX-43.4: RBAC & Scoping: Admin sees all branches, Manager sees own branch only
	// -------------------------------------------------------------
	console.log("\n🔎 FX-43.4: Admin sees all branches, Manager sees own branch only, Others 403");

	const { server, baseUrl, close } = await startTestServer();

	try {
		const adminToken = generateTestToken("admin", new mongoose.Types.ObjectId().toString());
		const managerToken = generateTestToken("frontdesk", managerUser._id.toString());
		const userToken = generateTestToken("user", regularUser._id.toString());

		// 1. Admin request -> gets all branches
		const adminRes = await fetchJson(baseUrl, "/dashboard/branch-board", {
			token: adminToken,
		});
		assert(adminRes.status === 200, "Admin receives 200 OK");
		assert(adminRes.data.branches.length >= 2, "Admin sees multiple branches on the board");

		// 2. Manager request -> scoped to Branch A only
		const managerRes = await fetchJson(baseUrl, "/dashboard/branch-board", {
			token: managerToken,
		});
		assert(managerRes.status === 200, "Manager receives 200 OK");
		assert(managerRes.data.branches.length === 1, "Manager sees exactly 1 branch");
		assert(
			managerRes.data.branches[0].branch.id === branchAId.toString(),
			"Manager only sees their assigned branch",
		);

		// 3. Regular member request -> 403 Forbidden
		const userRes = await fetchJson(baseUrl, "/dashboard/branch-board", {
			token: userToken,
		});
		assert(userRes.status === 403, "Regular user receives 403 Forbidden");
	} finally {
		await close();
	}

	// Cleanup test documents
	await Promise.all([
		GymVisit.findByIdAndDelete(visit._id),
		OperationalAlert.findByIdAndDelete(alert._id),
		Invoice.findByIdAndDelete(invoice._id),
		User.deleteMany({ _id: { $in: [managerUser._id, regularUser._id] } }),
	]);

	console.log("\n🎉 All Multi-Branch Operations Board (FX-43) backend tests passed!\n");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("Test execution failed:", err);
	process.exit(1);
});
