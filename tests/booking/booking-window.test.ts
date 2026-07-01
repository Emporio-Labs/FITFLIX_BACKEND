import assert from "node:assert";
import { checkBookingWindow, buildClassStartTimestamp } from "../../src/utils/booking-window";

// Unit Tests for checkBookingWindow

function runUnitTests() {
	console.log("Running Unit Tests for Booking Window");

	const classStartMs = Date.UTC(2026, 6, 1, 10, 0, 0, 0); // July 1, 2026, 10:00:00 UTC
	const windowOpenHours = 72;
	
	const windowOpenMs = classStartMs - (72 * 60 * 60 * 1000);

	// 1. Early request (Before window opens)
	const earlyMs = windowOpenMs - 1000;
	const earlyResult = checkBookingWindow(earlyMs, classStartMs, windowOpenHours);
	assert.strictEqual(earlyResult.ok, false);
	if (!earlyResult.ok) {
		assert.strictEqual(earlyResult.code, "BOOKING_WINDOW_NOT_OPEN");
	}
	console.log("✅ Early request test passed");

	// 2. On-time request (Window just opened)
	const onTimeOpenMs = windowOpenMs;
	const onTimeOpenResult = checkBookingWindow(onTimeOpenMs, classStartMs, windowOpenHours);
	assert.strictEqual(onTimeOpenResult.ok, true);
	console.log("✅ On-time (just opened) request test passed");

	// 3. On-time request (Middle of window)
	const onTimeMiddleMs = classStartMs - (24 * 60 * 60 * 1000);
	const onTimeMiddleResult = checkBookingWindow(onTimeMiddleMs, classStartMs, windowOpenHours);
	assert.strictEqual(onTimeMiddleResult.ok, true);
	console.log("✅ On-time (middle of window) request test passed");
	
	// 4. On-time request (Just before class starts)
	const onTimeBeforeStartMs = classStartMs - 1000;
	const onTimeBeforeStartResult = checkBookingWindow(onTimeBeforeStartMs, classStartMs, windowOpenHours);
	assert.strictEqual(onTimeBeforeStartResult.ok, true);
	console.log("✅ On-time (just before start) request test passed");

	// 5. Late request (At class start time)
	const lateStartMs = classStartMs;
	const lateStartResult = checkBookingWindow(lateStartMs, classStartMs, windowOpenHours);
	assert.strictEqual(lateStartResult.ok, false);
	if (!lateStartResult.ok) {
		assert.strictEqual(lateStartResult.code, "BOOKING_WINDOW_CLOSED");
	}
	console.log("✅ Late (at start) request test passed");

	// 6. Late request (After class started)
	const lateAfterMs = classStartMs + 1000;
	const lateAfterResult = checkBookingWindow(lateAfterMs, classStartMs, windowOpenHours);
	assert.strictEqual(lateAfterResult.ok, false);
	if (!lateAfterResult.ok) {
		assert.strictEqual(lateAfterResult.code, "BOOKING_WINDOW_CLOSED");
	}
	console.log("✅ Late (after start) request test passed");
}

runUnitTests();
console.log("All unit tests passed successfully.");
