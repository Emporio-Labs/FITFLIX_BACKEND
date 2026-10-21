import { describe, expect, it } from "bun:test";
import XLSX from "xlsx";
import {
	generateMigrationTemplateBuffer,
	parseAndValidateMigrationWorkbook,
	normalizePhone,
	parseExcelDate,
} from "../src/utils/member-migration-excel";

describe("Member Migration Excel Parser", () => {
	it("should normalize phone numbers properly", () => {
		expect(normalizePhone(" 98765 43210 ")).toBe("9876543210");
		expect(normalizePhone("+91-98765-43210")).toBe("+919876543210");
		expect(normalizePhone(" (987) 654-3210 ")).toBe("9876543210");
	});

	it("should parse dates from ISO strings and Excel date codes", () => {
		const parsed = parseExcelDate("2026-08-15");
		expect(parsed).not.toBeNull();
		expect(parsed?.toISOString().slice(0, 10)).toBe("2026-08-15");
	});

	it("should generate a valid template with 2 sheets and headers", () => {
		const buffer = generateMigrationTemplateBuffer();
		expect(buffer).toBeDefined();
		expect(buffer.length).toBeGreaterThan(0);

		const wb = XLSX.read(buffer, { type: "buffer" });
		expect(wb.SheetNames).toContain("Memberships");
		expect(wb.SheetNames).toContain("Past_Sessions");
	});

	it("should parse and validate the template workbook correctly", async () => {
		const buffer = generateMigrationTemplateBuffer();
		const result = await parseAndValidateMigrationWorkbook(buffer);

		expect(result.valid).toBe(true);
		expect(result.errors.length).toBe(0);
		expect(result.members.length).toBe(2);

		// John Doe: 50 total credits, 5 (Cryotherapy) + 5 (Ice Bath) + 2 (Hatha Yoga) = 12 used, 38 remaining
		const john = result.members.find((m) => m.phone === "9876543210");
		expect(john).toBeDefined();
		expect(john?.name).toBe("John Doe");
		expect(john?.totalCredits).toBe(50);
		expect(john?.creditsUsed).toBe(12);
		expect(john?.creditsRemaining).toBe(38);
		expect(john?.sessions.length).toBe(3);

		// Sarah Smith: 20 total credits, 2 (Vinyasa Yoga) + 2 (Power Yoga) = 4 used, 16 remaining
		const sarah = result.members.find((m) => m.phone === "9123456780");
		expect(sarah).toBeDefined();
		expect(sarah?.totalCredits).toBe(20);
		expect(sarah?.creditsUsed).toBe(4);
		expect(sarah?.creditsRemaining).toBe(16);
		expect(sarah?.sessions.length).toBe(2);
	});

	it("should reject when used credits exceed total credits", async () => {
		const wb = XLSX.utils.book_new();

		const wsMemberships = XLSX.utils.aoa_to_sheet([
			["Phone", "Name", "PlanName", "StartDate", "TotalCredits"],
			["9999999999", "Overdrawn Member", "Test Plan", "2026-08-01", 10],
		]);

		const wsSessions = XLSX.utils.aoa_to_sheet([
			["Phone", "ServiceName", "CreditsDeducted"],
			["9999999999", "Cryotherapy", 15], // 15 > 10
		]);

		XLSX.utils.book_append_sheet(wb, wsMemberships, "Memberships");
		XLSX.utils.book_append_sheet(wb, wsSessions, "Past_Sessions");

		const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
		const result = await parseAndValidateMigrationWorkbook(buffer);

		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.message.includes("less than past sessions used"))).toBe(true);
	});
});
