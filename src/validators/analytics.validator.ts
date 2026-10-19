import z from "zod";
import { ANALYTICS_PERIODS } from "../types/analytics";

/**
 * `GET /analytics/me` takes a period key and nothing else.
 *
 * Note what is deliberately absent: a `userId`. The nutrition adherence
 * controller lets staff pass one to read another member's rollup; this
 * endpoint is self-only, so there is no parameter to forget to authorize.
 */
export const analyticsQuerySchema = z.object({
	period: z.enum(ANALYTICS_PERIODS).default("30d"),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * FX-27 — `GET /analytics/funnels` takes an optional date window and an optional
 * branch. `from`/`to` are `YYYY-MM-DD` (or any Date-parseable string); the
 * controller defaults to the last 30 days when they're absent. `locationId` is
 * read via `readExplicitLocationId` (header or query), so it's optional here and
 * only declared to document the accepted shape.
 */
export const branchFunnelsQuerySchema = z.object({
	from: z.string().trim().optional(),
	to: z.string().trim().optional(),
	locationId: z.string().trim().optional(),
});

export type BranchFunnelsQuery = z.infer<typeof branchFunnelsQuerySchema>;
