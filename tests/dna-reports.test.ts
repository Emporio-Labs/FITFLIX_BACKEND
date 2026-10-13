import mongoose from "mongoose";
import { Gender, UserStatus } from "../src/models/Enums";
import MedicalReport from "../src/models/MedicalReport";
import User from "../src/models/User";
import { deleteFromS3 } from "../src/utils/s3.service";
import { assert, fetchJson, generateTestToken, startTestServer } from "./test-helpers";

/**
 * Covers who can file and read reports on a member:
 *   - a member uploads their own report (POST /users/me/reports); it is stored
 *     as a medical report from the client
 *   - a member cannot file a DNA report, by the DNA route or by typing a DNA
 *     report type on their own upload
 *   - only the front desk (admin / frontdesk) can file a DNA report
 *     (POST /users/:id/dna-reports); experts cannot
 *   - GET /users/me/reports returns both, and ?category= splits them — a
 *     record saved before the category field existed counts as medical
 *   - every staff role can list a member's reports (GET /users/:id/reports)
 *   - the front desk can delete a DNA report, but not a member's own upload
 */

const PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

async function uploadReport(
	baseUrl: string,
	path: string,
	token: string,
	fields: Record<string, string>,
	file?: { bytes: Buffer; type: string; name: string },
): Promise<{ status: number; data: any }> {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	if (file) {
		form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
	}
	const res = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}` },
		body: form,
	});
	let data: any = {};
	try {
		data = await res.json();
	} catch {}
	return { status: res.status, data };
}

const pdf = { bytes: PDF_BYTES, type: "application/pdf", name: "report.pdf" };

async function runDnaReportTests() {
	console.log("=== Feature Test: DNA + Member Reports ===");
	const { baseUrl, close } = await startTestServer();

	let memberId = "";

	try {
		const suffix = Date.now().toString().slice(-7);
		const member = await User.create({
			username: `dna_member_${suffix}`,
			email: `dna.${suffix}@fitflix.test`,
			phone: `+91990${suffix}`,
			gender: Gender.Female,
			age: 31,
			passwordHash: "hash123",
			firstName: "Dna",
			lastName: "Member",
			role: "user",
			status: UserStatus.Active,
			isActive: true,
			membershipStatus: "ACTIVE",
		});
		memberId = member._id.toString();

		const staffId = new mongoose.Types.ObjectId().toString();
		const memberToken = generateTestToken("user", memberId);
		const frontdeskToken = generateTestToken("frontdesk", staffId);
		const adminToken = generateTestToken("admin", staffId);
		const dnaPath = `/users/${memberId}/dna-reports`;

		console.log("\n1. A member uploads their own report...");
		const own = await uploadReport(
			baseUrl,
			"/users/me/reports",
			memberToken,
			{ reportName: "Blood panel", reportType: "Blood Test" },
			pdf,
		);
		assert(own.status === 201, "Member upload returns 201");
		assert(own.data.report?.category === "medical", "It is a medical report");
		assert(own.data.report?.source === "client", "It is marked as a client upload");
		assert(own.data.report?.title === "Blood panel", "It keeps the report name");
		assert(typeof own.data.report?.pdf_url === "string", "It comes back with a link");

		console.log("\n2. A member's upload is checked...");
		const noFile = await uploadReport(baseUrl, "/users/me/reports", memberToken, {
			reportName: "No file",
			reportType: "Blood Test",
		});
		assert(noFile.status === 400, "An upload with no file is refused");

		const fakePdf = await uploadReport(
			baseUrl,
			"/users/me/reports",
			memberToken,
			{ reportName: "Fake", reportType: "Blood Test" },
			{ bytes: Buffer.from("not a pdf at all"), type: "application/pdf", name: "x.pdf" },
		);
		assert(fakePdf.status === 400, "A file that is not really a PDF is refused");

		const noName = await uploadReport(
			baseUrl,
			"/users/me/reports",
			memberToken,
			{ reportName: " ", reportType: "Blood Test" },
			pdf,
		);
		assert(noName.status === 400, "A blank report name is refused");

		console.log("\n3. A member cannot file a DNA report...");
		for (const reportType of ["DNA Panel", "dna", "Genetic test"]) {
			const res = await uploadReport(
				baseUrl,
				"/users/me/reports",
				memberToken,
				{ reportName: "My DNA", reportType },
				pdf,
			);
			assert(res.status === 403, `Member upload typed "${reportType}" is refused`);
		}
		const memberOnDnaRoute = await uploadReport(
			baseUrl,
			dnaPath,
			memberToken,
			{ reportName: "My DNA" },
			pdf,
		);
		assert(memberOnDnaRoute.status === 403, "Member is refused on the DNA route");

		console.log("\n4. Experts cannot file a DNA report...");
		for (const role of ["trainer", "nutritionist", "sports_scientist", "doctor"]) {
			const res = await uploadReport(
				baseUrl,
				dnaPath,
				generateTestToken(role, staffId),
				{ reportName: "DNA" },
				pdf,
			);
			assert(res.status === 403, `${role} is refused on the DNA route`);
		}

		console.log("\n5. The front desk files a DNA report...");
		const dna = await uploadReport(
			baseUrl,
			dnaPath,
			frontdeskToken,
			{ reportName: "DNA report 2026" },
			pdf,
		);
		assert(dna.status === 201, "Front desk DNA upload returns 201");
		assert(dna.data.report?.category === "dna", "It is a DNA report");
		assert(dna.data.report?.source === "frontdesk", "It is marked as a front-desk upload");
		assert(dna.data.report?.uploadedBy === staffId, "It records who uploaded it");
		const dnaId = String(dna.data.report?._id);

		const adminDna = await uploadReport(
			baseUrl,
			dnaPath,
			adminToken,
			{ reportName: "DNA report (admin)" },
			pdf,
		);
		assert(adminDna.status === 201, "Admin DNA upload returns 201");

		const unknownMember = await uploadReport(
			baseUrl,
			`/users/${new mongoose.Types.ObjectId().toString()}/dna-reports`,
			frontdeskToken,
			{ reportName: "DNA" },
			pdf,
		);
		assert(unknownMember.status === 404, "DNA upload for an unknown member is 404");

		console.log("\n6. The member's feed splits by category...");
		// A record from before category/source existed.
		const legacy = await MedicalReport.collection.insertOne({
			userId: member._id,
			reportName: "Old onboarding report",
			reportType: "Blood Test",
			uploadedAt: new Date(Date.now() - 86_400_000),
		});

		const all = await fetchJson(baseUrl, "/users/me/reports", { token: memberToken });
		assert(all.status === 200, "GET /users/me/reports returns 200");
		assert(all.data.reports.length === 4, "The feed has all four reports");

		const onlyDna = await fetchJson(baseUrl, "/users/me/reports?category=dna", {
			token: memberToken,
		});
		assert(onlyDna.data.reports.length === 2, "category=dna returns the two DNA reports");
		assert(
			onlyDna.data.reports.every((r: any) => r.category === "dna" && r.source === "frontdesk"),
			"Every DNA report came from the front desk",
		);

		const onlyMedical = await fetchJson(baseUrl, "/users/me/reports?category=medical", {
			token: memberToken,
		});
		assert(onlyMedical.data.reports.length === 2, "category=medical returns the other two");
		assert(
			onlyMedical.data.reports.some((r: any) => r.id === legacy.insertedId.toString()),
			"A report with no category counts as medical",
		);

		const badCategory = await fetchJson(baseUrl, "/users/me/reports?category=xray", {
			token: memberToken,
		});
		assert(badCategory.status === 400, "An unknown category is refused");

		console.log("\n7. Staff can list a member's reports...");
		for (const role of ["admin", "frontdesk", "trainer", "nutritionist", "sports_scientist", "doctor"]) {
			const res = await fetchJson(baseUrl, `/users/${memberId}/reports`, {
				token: generateTestToken(role, staffId),
			});
			assert(res.status === 200, `${role} can list the member's reports`);
			assert(res.data.reports.length === 4, `${role} sees all four reports`);
		}
		const staffMedical = await fetchJson(
			baseUrl,
			`/users/${memberId}/reports?category=medical`,
			{ token: generateTestToken("nutritionist", staffId) },
		);
		assert(
			staffMedical.data.reports.length === 2 &&
				staffMedical.data.reports.every((r: any) => r.category === "medical"),
			"Staff can narrow the list to the member's own uploads",
		);
		const memberOnStaffList = await fetchJson(baseUrl, `/users/${memberId}/reports`, {
			token: memberToken,
		});
		assert(memberOnStaffList.status === 403, "A member is refused on the staff list");

		console.log("\n8. The front desk can delete a DNA report only...");
		const memberDelete = await fetchJson(baseUrl, `${dnaPath}/${dnaId}`, {
			method: "DELETE",
			token: memberToken,
		});
		assert(memberDelete.status === 403, "A member cannot delete a DNA report");

		const deleteOwnUpload = await fetchJson(baseUrl, `${dnaPath}/${own.data.report.id}`, {
			method: "DELETE",
			token: frontdeskToken,
		});
		assert(deleteOwnUpload.status === 404, "A member's own upload is not deletable here");

		const deleteDna = await fetchJson(baseUrl, `${dnaPath}/${dnaId}`, {
			method: "DELETE",
			token: frontdeskToken,
		});
		assert(deleteDna.status === 200, "Front desk deletes the DNA report");
		assert(
			(await MedicalReport.countDocuments({ _id: dnaId })) === 0,
			"The record is gone",
		);

		console.log("\n🎉 DNA + Member Report Tests Passed!");
	} finally {
		if (memberId) {
			const leftovers = await MedicalReport.find({ userId: memberId });
			for (const report of leftovers) {
				if (report.s3Key) await deleteFromS3(report.s3Key);
			}
			await MedicalReport.deleteMany({ userId: memberId });
			await User.findByIdAndDelete(memberId);
		}
		await close();
	}
}

runDnaReportTests()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("DNA report test failed:", err);
		process.exit(1);
	});
