import { describe, expect, test } from "bun:test";
import { isOutsideBackfillWindow } from "../src/utils/backfill-window";

const now = new Date("2026-11-28T15:00:00Z");
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("isOutsideBackfillWindow (7 days)", () => {
	test("trainer: today and up to 7 days back are open", () => {
		for (const d of ["2026-11-28", "2026-11-25", "2026-11-21"])
			expect(isOutsideBackfillWindow(day(d), "trainer", now, 7)).toBe(false);
	});
	test("trainer: 8+ days back is locked", () => {
		expect(isOutsideBackfillWindow(day("2026-11-20"), "trainer", now, 7)).toBe(true);
		expect(isOutsideBackfillWindow(day("2026-10-01"), "trainer", now, 7)).toBe(true);
	});
	test("future dates are never locked", () => {
		expect(isOutsideBackfillWindow(day("2026-11-29"), "trainer", now, 7)).toBe(false);
	});
	test("other staff roles are limited too", () => {
		for (const r of ["nutritionist", "frontdesk", "staff", undefined])
			expect(isOutsideBackfillWindow(day("2026-11-01"), r, now, 7)).toBe(true);
	});
	test("admins and members are never locked", () => {
		for (const r of ["admin", "ROLE_FRONT_DESK_STAFF", "user"])
			expect(isOutsideBackfillWindow(day("2026-01-01"), r, now, 7)).toBe(false);
	});
	test("window 0 allows only today", () => {
		expect(isOutsideBackfillWindow(day("2026-11-28"), "trainer", now, 0)).toBe(false);
		expect(isOutsideBackfillWindow(day("2026-11-27"), "trainer", now, 0)).toBe(true);
	});
});
