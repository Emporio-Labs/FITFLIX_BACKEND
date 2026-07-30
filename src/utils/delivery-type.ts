/**
 * Delivery-type vocabulary bridge.
 *
 * `Class.mode` is stored lowercase ("online" | "offline" | "hybrid") while
 * `ScheduledSession.deliveryType` is stored uppercase ("ONLINE" | "OFFLINE" |
 * "HYBRID"). Every place that derives a session's delivery type from its parent
 * class must cross that boundary the same way, so it lives here rather than
 * being re-implemented per call site.
 */
export type DeliveryType = "ONLINE" | "OFFLINE" | "HYBRID";

export const normalizeDeliveryType = (
	mode: string | undefined | null,
): DeliveryType => {
	const v = (mode || "").toUpperCase();
	if (v === "ONLINE" || v === "HYBRID") return v;
	return "OFFLINE";
};
