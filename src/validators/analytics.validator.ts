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
