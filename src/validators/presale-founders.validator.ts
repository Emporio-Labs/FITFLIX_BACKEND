import { z } from "zod";

export const goalOptions = ["Strength & body composition", "A consistent training routine", "Daily energy & performance", "Mobility & movement quality", "Sleep, stress & recovery habits", "An event, trip or sport"] as const;
export const reasonOptions = ["More present with my family", "Steadier energy for my day", "Confidence in the way I move", "Space to reset and recharge", "A routine I can rely on", "Preparing for a meaningful goal", "I am still discovering my why"] as const;
export const buyingPriorityOptions = ["Expert guidance I can trust", "A plan that fits my schedule", "Clear, measurable progress", "A calm, considered club experience", "Clarity on what is included", "Training and recovery in one place"] as const;
export const hesitationOptions = ["Finding time consistently", "Understanding the total investment", "Knowing which route suits me", "Confidence in the coaching process", "Understanding the opening and inclusions", "Nothing specific — I am ready to explore"] as const;
export const intentionOptions = ["Protect two realistic weekly windows", "Begin small and build consistently", "Review my progress with the team", "Ask for clarity before I commit", "I am not ready to set an intention"] as const;
export const locationOptions = ["Kompally / nearby", "Hyderabad — happy to travel", "Not sure about the commute", "Outside Hyderabad"] as const;
export const routineOptions = ["Rarely or irregularly", "Once a week", "2–3 times a week", "4+ times a week"] as const;
export const barrierOptions = ["A demanding schedule", "An unclear plan", "Lack of accountability", "Plateauing progress", "Recovery & consistency", "Nothing specific — ready for more"] as const;
export const supportOptions = ["One-to-one coaching", "Independent training + wellness", "Reformer Pilates", "Help choosing a route"] as const;
export const sessionOptions = ["1 session", "2 sessions", "3 sessions", "4+ sessions", "Help me find a rhythm"] as const;
export const windowOptions = ["Early morning", "Late morning", "Afternoon", "Evening", "Variable schedule"] as const;
export const timelineOptions = ["At the Kompally launch", "Within a month of opening", "Within 3 months of opening", "Exploring for now"] as const;
export const investmentOptions = ["Elite — ₹1,50,000 / year", "Club — ₹1,00,000 / year", "90-day programme — ₹1,50,000 MRP", "Pilates — packages from ₹6,000 + taxes", "I need to review the inclusions", "Not ready to invest yet"] as const;
export const decisionOptions = ["I decide independently", "With my partner or family", "I need more information"] as const;
export const nextOptions = ["Speak with the founder", "Discuss a club visit", "Keep my brief and explore"] as const;

export const answerSchema = z.object({
  goals: z.array(z.enum(goalOptions)).min(1).max(2), location: z.enum(locationOptions), motivation: z.string().trim().min(5).max(350), routine: z.enum(routineOptions), barrier: z.enum(barrierOptions), support: z.enum(supportOptions), sessions: z.enum(sessionOptions), windows: z.array(z.enum(windowOptions)).min(1).max(2), timeline: z.enum(timelineOptions), investment: z.enum(investmentOptions), decision: z.enum(decisionOptions), pledge: z.string().trim().max(240), nextStep: z.enum(nextOptions), buyingPriority: z.enum(buyingPriorityOptions).optional(), hesitation: z.enum(hesitationOptions).optional(),
});
export const currentAnswerSchema = answerSchema.extend({ motivation: z.enum(reasonOptions), pledge: z.union([z.enum(intentionOptions), z.literal("")]), buyingPriority: z.enum(buyingPriorityOptions), hesitation: z.enum(hesitationOptions) });
export const contactSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(254), phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{8,18}$/, "Enter a valid mobile number"), channel: z.enum(["Phone", "WhatsApp", "Email"]), adultConsent: z.literal(true), serviceConsent: z.literal(true), marketingConsent: z.boolean() });
export const attributionSchema = z.object({ source: z.string().max(200).optional(), medium: z.string().max(200).optional(), campaign: z.string().max(200).optional(), content: z.string().max(200).optional(), term: z.string().max(200).optional(), fbclid: z.string().max(500).optional() });
export const applicationSchema = z.object({ requestId: z.string().uuid(), answers: currentAnswerSchema, contact: contactSchema, attribution: attributionSchema, website: z.string().max(0) });
export const summarySchema = z.object({ title: z.string().min(1).max(120), reflection: z.string().min(1).max(600), rhythm: z.string().min(1).max(300), focus: z.array(z.string().max(180)).min(2).max(3), actions: z.array(z.string().max(240)).length(3), agenda: z.array(z.string().max(240)).length(3), narration: z.string().min(1).max(1300), approach: z.string().min(1).max(200) });

export type Answers = z.infer<typeof answerSchema>;
export type ApplicationInput = z.infer<typeof applicationSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type LeadRoute = "founder" | "concierge" | "explore";
export type ApplicationResult = { id: string; token: string; name: string; route: LeadRoute; fitScore: number; summary: Summary; summaryMode: "ai" | "structured"; answers: Answers; bookingStatus: string };
export type CampaignSettings = { confirmedMembers: number | null; deadline: string | null; bookingUrl: string | null; founderName: string; applicationOpen: boolean; presaleNote: string; metaPixelId: string | null; publicOrigin: string | null };
export const memberCapacity = 100;
export const defaultSettings: CampaignSettings = { confirmedMembers: null, deadline: null, bookingUrl: null, founderName: "FitFlix Founder", applicationOpen: true, presaleNote: "", metaPixelId: null, publicOrigin: null };
