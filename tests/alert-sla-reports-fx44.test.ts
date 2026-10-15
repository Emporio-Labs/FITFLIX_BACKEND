import assert from "node:assert";
import mongoose from "mongoose";
import app from "../src/app";
import { AlertSeverity, AlertStatus, AlertType } from "../src/models/Enums";
import Location from "../src/models/Location";
import OperationalAlert from "../src/models/OperationalAlert";
import User from "../src/models/User";
import connectDB from "../src/utils/db";
import { getJwtConfig, signAuthToken } from "../src/utils/jwt";
import {
	generateAlertReportCsv,
	getAlertSlaReport,
} from "../src/services/alert-report.service";
import { fetchJson, startTestServer } from "./test-helpers";

async function runTests() {
	console.log("🧪 Running Alert SLA & Accountability Reports (FX-44) Tests...");
	await connectDB();

	const jwtConfig = getJwtConfig();
	assert(jwtConfig, "JWT config required");

	const uniqueSuffix = Date.now().toString();
	const baseNow = new Date();

	// 1. Setup Test Locations
	const locationA = await Location.create({
		name: `Report Branch A ${uniqueSuffix}`,
		code: `rep_branch_a_${uniqueSuffix}`,
		timezone: "Asia/Kolkata",
		isActive: true,
	});

	const locationB = await Location.create({
		name: `Report Branch B ${uniqueSuffix}`,
		code: `rep_branch_b_${uniqueSuffix}`,
		timezone: "Asia/Kolkata",
		isActive: true,
	});

	// 2. Setup Test Users (Staff & Manager)
	const staffAlice = await User.create({
		username: `Alice Frontdesk ${uniqueSuffix}`,
		email: `alice_${uniqueSuffix}@fitflix.test`,
		phone: `91000${uniqueSuffix.slice(-5)}1`,
		age: 26,
		gender: "Female",
		homeLocationId: locationA._id,
		isActive: true,
	});

	const staffBob = await User.create({
		username: `Bob Frontdesk ${uniqueSuffix}`,
		email: `bob_${uniqueSuffix}@fitflix.test`,
		phone: `91000${uniqueSuffix.slice(-5)}2`,
		age: 28,
		gender: "Male",
		homeLocationId: locationA._id,
		isActive: true,
	});

	const managerA = await User.create({
		username: `Manager Alpha ${uniqueSuffix}`,
		email: `manager_${uniqueSuffix}@fitflix.test`,
		phone: `91000${uniqueSuffix.slice(-5)}3`,
		age: 35,
		gender: "Other",
		homeLocationId: locationA._id,
		isActive: true,
	});

	const regularUser = await User.create({
		username: `Regular Member ${uniqueSuffix}`,
		email: `user_${uniqueSuffix}@fitflix.test`,
		phone: `91000${uniqueSuffix.slice(-5)}4`,
		age: 24,
		gender: "Male",
		isActive: true,
	});

	const adminToken = signAuthToken(
		{ id: new mongoose.Types.ObjectId().toString(), email: "owner@fitflix.test", role: "admin" },
		jwtConfig,
	);

	const managerToken = signAuthToken(
		{ id: managerA._id.toString(), email: managerA.email!, role: "frontdesk" },
		jwtConfig,
	);

	const userToken = signAuthToken(
		{ id: regularUser._id.toString(), email: regularUser.email!, role: "user" },
		jwtConfig,
	);

	try {
		// 3. Create Sample Alerts for Location A
		// Alert 1: Fast response (1 min) by Alice (SLA = 2m -> NOT breached)
		const alert1Created = new Date(baseNow.getTime() - 60 * 60 * 1000); // 1 hour ago
		const alert1Ack = new Date(alert1Created.getTime() + 60 * 1000); // +1 min
		await OperationalAlert.create({
			type: AlertType.TrainerMissing,
			severity: AlertSeverity.Critical,
			status: AlertStatus.Acknowledged,
			title: "Trainer Missing Class 1",
			message: "Trainer missing",
			branchId: locationA._id,
			targetRoles: ["frontdesk"],
			escalationLadder: [
				{ role: "branch_manager", afterMinutes: 2 },
				{ role: "admin", afterMinutes: 5 },
			],
			relatedEntity: { entityType: "session", entityId: "sess_001" },
			acknowledgedBy: {
				userId: staffAlice._id,
				name: staffAlice.username,
				role: "frontdesk",
			},
			acknowledgedAt: alert1Ack,
			createdAt: alert1Created,
		});

		// Alert 2: Slow response (8 min) by Alice (SLA = 2m -> BREACHED!)
		// Escalated past 2m (branch_manager) and 5m (admin)
		const alert2Created = new Date(baseNow.getTime() - 50 * 60 * 1000); // 50m ago
		const alert2Ack = new Date(alert2Created.getTime() + 8 * 60 * 1000); // +8 min
		await OperationalAlert.create({
			type: AlertType.TrainerMissing,
			severity: AlertSeverity.Critical,
			status: AlertStatus.Acknowledged,
			title: "Trainer Missing Class 2",
			message: "Trainer missing delayed",
			branchId: locationA._id,
			targetRoles: ["frontdesk"],
			escalationLadder: [
				{ role: "branch_manager", afterMinutes: 2 },
				{ role: "admin", afterMinutes: 5 },
			],
			relatedEntity: { entityType: "session", entityId: "sess_002" },
			acknowledgedBy: {
				userId: staffAlice._id,
				name: staffAlice.username,
				role: "frontdesk",
			},
			acknowledgedAt: alert2Ack,
			createdAt: alert2Created,
		});

		// Alert 3: Handled by Bob in 4 min (SLA = 15m for lead -> NOT breached)
		const alert3Created = new Date(baseNow.getTime() - 40 * 60 * 1000);
		const alert3Ack = new Date(alert3Created.getTime() + 4 * 60 * 1000);
		await OperationalAlert.create({
			type: AlertType.LeadUnclaimed,
			severity: AlertSeverity.Warning,
			status: AlertStatus.Acknowledged,
			title: "Unclaimed Lead John",
			message: "New lead waiting",
			branchId: locationA._id,
			targetRoles: ["frontdesk"],
			escalationLadder: [
				{ role: "branch_manager", afterMinutes: 15 },
			],
			relatedEntity: { entityType: "lead", entityId: "lead_001" },
			acknowledgedBy: {
				userId: staffBob._id,
				name: staffBob.username,
				role: "frontdesk",
			},
			acknowledgedAt: alert3Ack,
			createdAt: alert3Created,
		});

		// Alert 4: Unclaimed Lead Open for 30 min (SLA = 15m -> BREACHED & Still Open!)
		const alert4Created = new Date(baseNow.getTime() - 30 * 60 * 1000);
		await OperationalAlert.create({
			type: AlertType.LeadUnclaimed,
			severity: AlertSeverity.Warning,
			status: AlertStatus.Open,
			title: "Unclaimed Lead Sarah",
			message: "Hot lead unclaimed",
			branchId: locationA._id,
			targetRoles: ["frontdesk"],
			escalationLadder: [
				{ role: "branch_manager", afterMinutes: 15 },
				{ role: "admin", afterMinutes: 30 },
			],
			relatedEntity: { entityType: "lead", entityId: "lead_002" },
			createdAt: alert4Created,
		});

		// Alert 5: In Location B (EmergencyCall, acknowledged in 1m by Manager A)
		const alert5Created = new Date(baseNow.getTime() - 20 * 60 * 1000);
		const alert5Ack = new Date(alert5Created.getTime() + 1 * 60 * 1000);
		await OperationalAlert.create({
			type: AlertType.EmergencyCall,
			severity: AlertSeverity.Critical,
			status: AlertStatus.Acknowledged,
			title: "Emergency Floor B",
			message: "Incident",
			branchId: locationB._id,
			targetRoles: ["frontdesk"],
			escalationLadder: [{ role: "branch_manager", afterMinutes: 1 }],
			relatedEntity: { entityType: "other", entityId: "em_001" },
			acknowledgedBy: {
				userId: managerA._id,
				name: managerA.username,
				role: "branch_manager",
			},
			acknowledgedAt: alert5Ack,
			createdAt: alert5Created,
		});

		// =========================================================================
		// TEST SUITE 1: FX-44.1, FX-44.2, FX-44.3 via Service Logic
		// =========================================================================
		console.log("\n🔎 TEST 1: Service calculates FX-44 metrics for Location A");
		const reportA = await getAlertSlaReport({
			branchId: locationA._id,
			startDate: new Date(baseNow.getTime() - 2 * 60 * 60 * 1000),
			endDate: baseNow,
			now: baseNow,
		});

		// Verify Summary
		assert.strictEqual(reportA.summary.totalFired, 4, "Location A should have 4 fired alerts");
		assert.strictEqual(reportA.summary.totalAcknowledged, 3, "3 alerts should be acknowledged");
		assert.strictEqual(reportA.summary.totalBreached, 2, "2 alerts should be breached (Alert 2 and Alert 4)");

		// Verify FX-44.1: By Type
		const trainerMissingStat = reportA.byType.find((t) => t.type === AlertType.TrainerMissing);
		assert(trainerMissingStat, "TrainerMissing stats must exist");
		assert.strictEqual(trainerMissingStat.firedCount, 2, "2 TrainerMissing alerts fired");
		assert.strictEqual(trainerMissingStat.breachedCount, 1, "1 TrainerMissing alert breached");

		const leadUnclaimedStat = reportA.byType.find((t) => t.type === AlertType.LeadUnclaimed);
		assert(leadUnclaimedStat, "LeadUnclaimed stats must exist");
		assert.strictEqual(leadUnclaimedStat.firedCount, 2, "2 LeadUnclaimed alerts fired");
		assert.strictEqual(leadUnclaimedStat.breachedCount, 1, "1 LeadUnclaimed alert breached");

		console.log("  ✅ FX-44.1 Metrics by alert type verified");

		// Verify FX-44.2: Response times per Person and Role
		const aliceStat = reportA.byPerson.find((p) => p.name === staffAlice.username);
		assert(aliceStat, "Alice performance stats must exist");
		assert.strictEqual(aliceStat.handledCount, 2, "Alice handled 2 alerts");
		// Alice times: 60s (1m) and 480s (8m). Avg = 270s (4.5m). Slowest = 480s (8m)
		assert.strictEqual(aliceStat.avgResponseSeconds, 270, "Alice avg response time should be 270s");
		assert.strictEqual(aliceStat.slowestResponseSeconds, 480, "Alice slowest response should be 480s");
		assert.strictEqual(aliceStat.breachCount, 1, "Alice should have 1 breach");

		const bobStat = reportA.byPerson.find((p) => p.name === staffBob.username);
		assert(bobStat, "Bob performance stats must exist");
		assert.strictEqual(bobStat.handledCount, 1, "Bob handled 1 alert");
		assert.strictEqual(bobStat.avgResponseSeconds, 240, "Bob avg response time should be 240s (4m)");
		assert.strictEqual(bobStat.slowestResponseSeconds, 240, "Bob slowest response should be 240s");
		assert.strictEqual(bobStat.breachCount, 0, "Bob should have 0 breaches");

		const frontdeskRoleStat = reportA.byRole.find((r) => r.role === "frontdesk");
		assert(frontdeskRoleStat, "Frontdesk role stats must exist");
		assert.strictEqual(frontdeskRoleStat.handledCount, 3, "Frontdesk handled 3 alerts");
		assert.strictEqual(frontdeskRoleStat.breachCount, 1, "Frontdesk role had 1 breach");

		console.log("  ✅ FX-44.2 Average and slowest times per person and role verified");

		// Verify FX-44.3: Breaches with Full Escalation History
		assert.strictEqual(reportA.breaches.length, 2, "Should return exactly 2 breaches");
		const breach2 = reportA.breaches.find((b) => b.title === "Trainer Missing Class 2");
		assert(breach2, "Breach 2 must be listed in breaches");
		assert.strictEqual(breach2.escalationLadder.length, 2, "Should have 2 escalation milestones");
		assert.strictEqual(breach2.escalationLadder[0].escalated, true, "Milestone 1 (2m) was reached/escalated");
		assert.strictEqual(breach2.escalationLadder[1].escalated, true, "Milestone 2 (5m) was reached/escalated");
		assert(breach2.fullEscalationTrail.length >= 3, "Full escalation audit trail must be recorded");

		const breach4 = reportA.breaches.find((b) => b.title === "Unclaimed Lead Sarah");
		assert(breach4, "Breach 4 (open breach) must be listed");
		assert.strictEqual(breach4.status, AlertStatus.Open);
		assert(breach4.fullEscalationTrail.some((t) => t.includes("UNRESOLVED")), "Trail records open state");

		console.log("  ✅ FX-44.3 Breaches with full escalation history verified");

		// =========================================================================
		// TEST SUITE 2: FX-44.4 CSV Export Formatting
		// =========================================================================
		console.log("\n🔎 TEST 2: CSV spreadsheet export formatting (FX-44.4)");
		const csv = generateAlertReportCsv(reportA);
		assert(csv.includes("FITFLIX OPERATIONAL ALERTS & SLA ACCOUNTABILITY REPORT"), "CSV contains title");
		assert(csv.includes("ALERTS BY TYPE (FX-44.1)"), "CSV contains Table 1 header");
		assert(csv.includes("PERFORMANCE PER PERSON (FX-44.2)"), "CSV contains Table 2 header");
		assert(csv.includes("PERFORMANCE PER ROLE (FX-44.2)"), "CSV contains Table 3 header");
		assert(csv.includes("BREACHED ALERTS & ESCALATION AUDIT LOG (FX-44.3)"), "CSV contains Table 4 header");
		assert(csv.includes(staffAlice.username), "CSV lists Alice");
		assert(csv.includes("Trainer Missing Class 2"), "CSV lists breach title");
		console.log("  ✅ FX-44.4 CSV spreadsheet output structure verified");

		// =========================================================================
		// TEST SUITE 3: HTTP API Endpoint & RBAC Scoping
		// =========================================================================
		console.log("\n🔎 TEST 3: HTTP API Endpoints and Access Control");

		const { baseUrl, close } = await startTestServer();

		try {
			// 3.1 Admin GET /api/v1/alerts/reports (All branches)
			const resAdmin = await fetchJson(baseUrl, "/api/v1/alerts/reports", {
				token: adminToken,
			});
			assert.strictEqual(resAdmin.status, 200, "Admin receives 200");
			assert(resAdmin.data.summary.totalFired >= 5, "Admin sees alerts across branches A and B");

			// 3.2 Admin GET /api/v1/alerts/reports?branchId=locationA
			const resAdminLocA = await fetchJson(baseUrl, `/api/v1/alerts/reports?branchId=${locationA._id}`, {
				token: adminToken,
			});
			assert.strictEqual(resAdminLocA.status, 200, "Admin single branch receives 200");
			assert.strictEqual(resAdminLocA.data.summary.totalFired, 4, "Filtered to branch A (4 alerts)");

			// 3.3 Manager GET /api/v1/alerts/reports (auto-scoped to homeLocationId = Location A)
			const resManager = await fetchJson(baseUrl, "/api/v1/alerts/reports", {
				token: managerToken,
			});
			assert.strictEqual(resManager.status, 200, "Manager receives 200");
			assert.strictEqual(resManager.data.summary.totalFired, 4, "Manager automatically scoped to Location A");

			// 3.4 CSV Export HTTP Endpoint
			const csvRes = await fetch(`${baseUrl}/api/v1/alerts/reports/export?branchId=${locationA._id}`, {
				headers: { Authorization: `Bearer ${adminToken}` },
			});
			assert.strictEqual(csvRes.status, 200, "CSV export returns 200");
			assert(csvRes.headers.get("content-type")?.includes("text/csv"), "Content-Type is text/csv");
			const csvText = await csvRes.text();
			assert(csvText.includes("BREACHED ALERTS & ESCALATION AUDIT LOG"), "CSV text returned correctly");

			// 3.5 Unauthorized Regular Member 403
			const resForbidden = await fetchJson(baseUrl, "/api/v1/alerts/reports", {
				token: userToken,
			});
			assert.strictEqual(resForbidden.status, 403, "Regular member receives 403");

			console.log("  ✅ HTTP API and RBAC scoping verified");
		} finally {
			await close();
		}
	} finally {
		// Clean up test data
		await Promise.all([
			Location.deleteMany({ _id: { $in: [locationA._id, locationB._id] } }),
			User.deleteMany({ _id: { $in: [staffAlice._id, staffBob._id, managerA._id, regularUser._id] } }),
			OperationalAlert.deleteMany({ branchId: { $in: [locationA._id, locationB._id] } }),
		]);
	}

	console.log("\n🎉 All Alert SLA & Accountability Reports (FX-44) backend tests passed!\n");
	process.exit(0);
}

runTests().catch((err) => {
	console.error("❌ Test failed:", err);
	process.exit(1);
});
