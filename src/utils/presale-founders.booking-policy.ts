import type { LeadRoute } from "../validators/presale-founders.validator";

export function publicFounderSlot(slot: {
  _id: string;
  startAt: Date;
  endAt: Date;
}) {
  return {
    id: slot._id,
    startAt: slot.startAt.toISOString(),
    endAt: slot.endAt.toISOString(),
  };
}

// Any applicant may voluntarily request a pending team follow-up.
// Only founder-route applicants may request a published founder window.
export function canRequestCallWindow(route: LeadRoute, slotId?: string) {
  return slotId === undefined || route === "founder";
}
