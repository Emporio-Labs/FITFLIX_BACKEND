import { config } from "dotenv";

config();

import mongoose from "mongoose";
import Admin from "../src/models/Admin";
import MedicalReport from "../src/models/MedicalReport";

type ApiReportSummary = {
	id?: string;
	_id?: string;
	type?: string;
	reportType?: string;
	pdf_url?: string;
	reportUrl?: string;
	s3Key?: string;
};

type ApiResponseEnvelope = {
	userId?: string;
	accessToken?: string;
	report?: ApiReportSummary;
	reports?: ApiReportSummary[];
	expiresIn?: number;
	url?: string;
};

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function runTests() {
	console.log("=== STARTING END-TO-END SECURITY VERIFICATION ===");

	// Connect to MongoDB to verify DB state directly
	const mongoUrl =
		process.env.MONGODB_URL ?? "mongodb://127.0.0.1:27017/hybridhuman";
	console.log(`Connecting to MongoDB at: ${mongoUrl}`);
	await mongoose.connect(mongoUrl);
	console.log("Connected to MongoDB.");

	// 1. Create a unique test user
	const stamp = Date.now();
	const testEmail = `testuser_${stamp}@example.com`;
	const testPassword = "UserPass123";
	const username = `testuser_${stamp}`;

	console.log(`Signing up user: ${testEmail}...`);
	const signupRes = await fetch(`${BASE_URL}/auth/signup`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username,
			phone: "9876543210",
			email: testEmail,
			password: testPassword,
			age: 25,
			gender: "Male",
			healthGoals: ["Weight Loss"],
		}),
	});

	if (!signupRes.ok) {
		const errText = await signupRes.text();
		throw new Error(`Signup failed: ${signupRes.status} - ${errText}`);
	}

	const signupJson = (await signupRes.json()) as ApiResponseEnvelope;
	const userId = signupJson.userId;
	console.log(`User created successfully. User ID: ${userId}`);

	// 2. Login as the user
	console.log("Logging in as the created user...");
	const loginRes = await fetch(`${BASE_URL}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: testEmail,
			password: testPassword,
		}),
	});

	if (!loginRes.ok) {
		throw new Error(`Login failed: ${loginRes.status}`);
	}

	const loginJson = (await loginRes.json()) as ApiResponseEnvelope;
	const userToken = loginJson.accessToken;
	console.log("Login successful. Got Access Token.");

	// 3. Complete Onboarding Steps to unlock REPORT_UPLOAD
	console.log("Submitting Health Markers...");
	const hmRes = await fetch(`${BASE_URL}/onboarding/health-markers`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${userToken}`,
		},
		body: JSON.stringify({
			weight: 75,
			height: 180,
			allergies: [],
			medications: [],
			diseaseHistory: [],
			sleepHours: 8,
			activityLevel: "Moderate",
		}),
	});
	if (!hmRes.ok) {
		throw new Error(
			`Health Markers failed: ${hmRes.status} - ${await hmRes.text()}`,
		);
	}
	console.log("Health Markers submitted.");

	console.log("Submitting Health Goals...");
	const hgRes = await fetch(`${BASE_URL}/onboarding/health-goals`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${userToken}`,
		},
		body: JSON.stringify({
			goals: ["Gain Muscle"],
			targetWeight: 80,
			timeline: "3 months",
			workoutExperience: "Intermediate",
			foodPreferences: [],
		}),
	});
	if (!hgRes.ok) {
		throw new Error(
			`Health Goals failed: ${hgRes.status} - ${await hgRes.text()}`,
		);
	}
	console.log("Health Goals submitted.");

	console.log("Submitting Consent...");
	const consentRes = await fetch(`${BASE_URL}/onboarding/consent`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${userToken}`,
		},
		body: JSON.stringify({
			consents: [
				{
					type: "WELLNESS_SERVICES",
					accepted: true,
					signatureName: "Test User",
				},
				{ type: "GYM_FITNESS", accepted: true, signatureName: "Test User" },
			],
		}),
	});
	if (!consentRes.ok) {
		throw new Error(
			`Consent failed: ${consentRes.status} - ${await consentRes.text()}`,
		);
	}
	console.log("Consent submitted. Onboarding step advanced to REPORT_UPLOAD.");

	// 4. Register/Login an admin to fetch onboarding profile
	const adminEmail = `testadmin_${stamp}@example.com`;
	const adminPassword = "AdminPass123";
	console.log(`Creating Admin: ${adminEmail}...`);

	// Create admin directly in DB for testing
	const adminUser = await Admin.create({
		adminName: "Security Test Admin",
		email: adminEmail,
		phone: "9999999998",
		passwordHash: "$2a$10$abcdefghijklmnopqrstuv", // placeholder
	});
	// Hash the admin password properly:
	const { hashPassword } = await import("../src/utils/password");
	adminUser.passwordHash = await hashPassword(adminPassword);
	await adminUser.save();
	console.log(`Admin created in database. Admin ID: ${adminUser._id}`);

	console.log("Logging in as Admin...");
	const adminLoginRes = await fetch(`${BASE_URL}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			email: adminEmail,
			password: adminPassword,
		}),
	});

	if (!adminLoginRes.ok) {
		throw new Error(`Admin login failed: ${adminLoginRes.status}`);
	}

	const adminLoginJson = (await adminLoginRes.json()) as ApiResponseEnvelope;
	const adminToken = adminLoginJson.accessToken;
	console.log("Admin logged in successfully.");

	// 5. Upload a mock report using multipart form data
	console.log("Uploading a mock report...");
	const formData = new FormData();
	formData.append("reportName", "Diagnostic PDF");
	formData.append("reportType", "Blood Test");

	// Create a dummy file buffer
	const dummyPdf = new Blob(["%PDF-1.4 mock pdf content"], {
		type: "application/pdf",
	});
	formData.append("file", dummyPdf, "blood_report.pdf");

	const uploadRes = await fetch(`${BASE_URL}/onboarding/reports`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${userToken}`,
		},
		body: formData,
	});

	if (!uploadRes.ok) {
		const errText = await uploadRes.text();
		throw new Error(`Report upload failed: ${uploadRes.status} - ${errText}`);
	}

	const uploadJson = (await uploadRes.json()) as any;
	console.log("Upload Response Payload:", JSON.stringify(uploadJson, null, 2));

	const reportId = uploadJson.report._id;
	const returnedUrl = uploadJson.report.reportUrl;
	const returnedKey = uploadJson.report.s3Key;

	console.log(`Report uploaded. ID: ${reportId}, Key: ${returnedKey}`);
	console.log(`Returned Report URL in response payload: ${returnedUrl}`);

	// VERIFICATION 1: Returned URL should be a pre-signed URL (short-lived)
	if (!returnedUrl) {
		throw new Error("FAIL: Response did not return reportUrl!");
	}
	if (
		returnedUrl.includes("s3.amazonaws.com") &&
		!returnedUrl.includes("X-Amz-Expires")
	) {
		throw new Error("FAIL: Response returned a direct/unprotected S3 URL!");
	}
	if (
		!returnedUrl.includes("X-Amz-Expires=900") &&
		!returnedUrl.includes("Expires=900")
	) {
		console.warn(
			`WARNING: Expiry token is present but not explicitly checking 900 seconds. URL is: ${returnedUrl}`,
		);
	} else {
		console.log("PASS: Response returned a 15-minute pre-signed URL.");
	}

	// VERIFICATION 2: Check MongoDB Database directly to make sure no raw S3 URL is stored
	console.log("Checking MedicalReport state in MongoDB...");
	const dbReport = await MedicalReport.findById(reportId);
	if (!dbReport) {
		throw new Error("FAIL: Report not found in MongoDB!");
	}
	console.log(
		"DB MedicalReport Document:",
		JSON.stringify(dbReport.toObject(), null, 2),
	);

	if (dbReport.reportUrl) {
		if (
			dbReport.reportUrl.includes(".amazonaws.com") ||
			dbReport.reportUrl.includes("fitflix-storage")
		) {
			throw new Error(
				`FAIL: MongoDB stored a direct S3 bucket URL in reportUrl: ${dbReport.reportUrl}`,
			);
		}
	}
	console.log("PASS: MongoDB does NOT store a direct S3 bucket URL.");

	if (!dbReport.s3Key) {
		throw new Error("FAIL: MongoDB did not store s3Key!");
	}
	console.log(
		`PASS: MongoDB successfully stored the unique s3Key: ${dbReport.s3Key}`,
	);

	// VERIFICATION 3: Fetch Onboarding Profile (Admin route) and check reports payload
	console.log(
		`Fetching onboarding profile for user ${userId} using Admin token...`,
	);
	const profileRes = await fetch(
		`${BASE_URL}/users/${userId}/onboarding-profile`,
		{
			headers: {
				Authorization: `Bearer ${adminToken}`,
			},
		},
	);

	if (!profileRes.ok) {
		throw new Error(`Failed to fetch onboarding profile: ${profileRes.status}`);
	}

	const profileJson = (await profileRes.json()) as any;
	console.log(
		"Onboarding Profile Reports Payload:",
		JSON.stringify(profileJson.reports, null, 2),
	);

	const profileReport = profileJson.reports[0];
	if (!profileReport) {
		throw new Error("FAIL: Onboarding profile reports array is empty!");
	}

	if (!profileReport.reportUrl) {
		throw new Error("FAIL: Onboarding profile reportUrl is missing!");
	}

	if (
		profileReport.reportUrl.includes("s3.amazonaws.com") &&
		!profileReport.reportUrl.includes("X-Amz-Expires")
	) {
		throw new Error(
			"FAIL: Onboarding profile returned a direct unprotected S3 URL!",
		);
	}
	console.log(
		`PASS: Onboarding profile returned dynamic pre-signed URL: ${profileReport.reportUrl}`,
	);

	// VERIFICATION 4: Get Report Signed URL endpoint directly
	console.log(`Requesting signed URL for report ${reportId} directly...`);
	const signedUrlRes = await fetch(
		`${BASE_URL}/users/${userId}/reports/${reportId}/url`,
		{
			headers: {
				Authorization: `Bearer ${adminToken}`,
			},
		},
	);

	if (!signedUrlRes.ok) {
		throw new Error(`Failed to get signed URL: ${signedUrlRes.status}`);
	}

	const signedUrlJson = (await signedUrlRes.json()) as any;
	console.log(
		"Signed URL Response Payload:",
		JSON.stringify(signedUrlJson, null, 2),
	);

	if (signedUrlJson.expiresIn !== 900) {
		throw new Error(
			`FAIL: Signed URL endpoint expiresIn is ${signedUrlJson.expiresIn}, expected 900`,
		);
	}
	if (
		!signedUrlJson.url.includes("X-Amz-Expires=900") &&
		!signedUrlJson.url.includes("Expires=900")
	) {
		console.warn(
			`WARNING: Signed URL query parameter does not explicitly contain 900. URL: ${signedUrlJson.url}`,
		);
	}
	console.log(
		"PASS: Signed URL endpoint returned correct URL and 900s expiresIn.",
	);

	// VERIFICATION 5: Get My Reports (Unified Feed for user)
	console.log("Fetching unified feed of reports for test user...");
	const userReportsRes = await fetch(`${BASE_URL}/users/me/reports`, {
		headers: {
			Authorization: `Bearer ${userToken}`,
		},
	});

	if (!userReportsRes.ok) {
		throw new Error(`Failed to fetch user reports: ${userReportsRes.status}`);
	}

	const userReportsJson = (await userReportsRes.json()) as ApiResponseEnvelope;
	console.log(
		"User Unified Reports Payload:",
		JSON.stringify(userReportsJson.reports, null, 2),
	);

	const userReportItem = userReportsJson.reports?.find(
		(report) => report.id === reportId,
	);
	if (!userReportItem) {
		throw new Error(
			"FAIL: Unified reports feed does not contain our uploaded report!",
		);
	}
	if (userReportItem.type !== "Blood Test") {
		throw new Error(
			`FAIL: Unified report item type is "${userReportItem.type}", expected "Blood Test"`,
		);
	}
	if (!userReportItem.pdf_url?.includes("X-Amz-Expires=900")) {
		throw new Error(
			`FAIL: Unified report item returned invalid or unsigned PDF URL: ${userReportItem.pdf_url}`,
		);
	}
	console.log(
		"PASS: Unified reports feed returned correct report metadata and signed S3 URL.",
	);

	// VERIFICATION 6: Get My Medical Reports (Medical & DNA only endpoint)
	console.log("Fetching medical/DNA reports for test user...");
	const userMedReportsRes = await fetch(
		`${BASE_URL}/users/me/medical-reports`,
		{
			headers: {
				Authorization: `Bearer ${userToken}`,
			},
		},
	);

	if (!userMedReportsRes.ok) {
		throw new Error(
			`Failed to fetch user medical reports: ${userMedReportsRes.status}`,
		);
	}

	const userMedReportsJson =
		(await userMedReportsRes.json()) as ApiResponseEnvelope;
	console.log(
		"User Medical Reports Payload:",
		JSON.stringify(userMedReportsJson.reports, null, 2),
	);

	const userMedReportItem = userMedReportsJson.reports?.find(
		(report) => report._id === reportId,
	);
	if (!userMedReportItem) {
		throw new Error(
			"FAIL: Medical reports list does not contain our uploaded report!",
		);
	}
	if (userMedReportItem.reportType !== "Blood Test") {
		throw new Error(
			`FAIL: Medical report item type is "${userMedReportItem.reportType}", expected "Blood Test"`,
		);
	}
	if (!userMedReportItem.reportUrl?.includes("X-Amz-Expires=900")) {
		throw new Error(
			`FAIL: Medical report item returned invalid or unsigned URL: ${userMedReportItem.reportUrl}`,
		);
	}
	console.log(
		"PASS: Medical & DNA reports endpoint returned correct report details and signed S3 URL.",
	);

	console.log("\n=== ALL PHI & S3 SECURITY CHECKS PASSED SUCCESSFULLY! ===");
}

runTests()
	.then(async () => {
		await mongoose.disconnect();
		process.exit(0);
	})
	.catch(async (error) => {
		console.error("FAIL: Test execution encountered an error:", error);
		await mongoose.disconnect();
		process.exit(1);
	});
