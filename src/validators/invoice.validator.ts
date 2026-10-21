import z from "zod";
import { InvoicePaymentMethod, InvoicePaymentStatus } from "../models/Enums";

const paymentStatusValues = Object.values(InvoicePaymentStatus) as [
	string,
	...string[],
];
const paymentMethodValues = Object.values(InvoicePaymentMethod) as [
	string,
	...string[],
];

const VALID_TRANSITIONS: Record<string, string[]> = {
	[InvoicePaymentStatus.DRAFT]: [
		InvoicePaymentStatus.PENDING,
		InvoicePaymentStatus.PAID,
		InvoicePaymentStatus.CANCELLED,
	],
	[InvoicePaymentStatus.PENDING]: [
		InvoicePaymentStatus.PAID,
		InvoicePaymentStatus.FAILED,
		InvoicePaymentStatus.CANCELLED,
	],
	[InvoicePaymentStatus.PAID]: [InvoicePaymentStatus.REFUNDED],
	[InvoicePaymentStatus.FAILED]: [InvoicePaymentStatus.CANCELLED],
	[InvoicePaymentStatus.CANCELLED]: [],
	[InvoicePaymentStatus.REFUNDED]: [],
};

export const isValidStatusTransition = (from: string, to: string): boolean => {
	return (VALID_TRANSITIONS[from] ?? []).includes(to);
};

const optionalString = z.preprocess(
	(v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
	z.string().trim().min(1).optional(),
);

/** A calendar day, "YYYY-MM-DD", that actually exists. */
const calendarDay = z
	.string()
	.trim()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
	.refine((v) => {
		const d = new Date(`${v}T00:00:00Z`);
		return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
	}, "Not a real date");

export const createInvoiceBodySchema = z.object({
	userId: z.string().trim().optional(),
	leadId: z.string().trim().optional(),
	/** A walk-in with no lead yet: a Lead is created, then the account resolved. */
	newLead: z
		.object({
			name: z.string().trim().min(1),
			phone: z
				.string()
				.trim()
				.refine(
					(v) => v.replace(/\D/g, "").length >= 10,
					"Phone needs at least 10 digits",
				),
			email: z.preprocess(
				(v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
				z.string().trim().email().optional(),
			),
		})
		.optional(),
	items: z
		.array(
			z.object({
				name: z.string().trim().min(1),
				price: z.number().nonnegative(),
				quantity: z.number().int().positive(),
			}),
		)
		.min(1, "At least one item is required"),
	/** Omitted, it is computed from the branch's taxRatePercent. */
	tax: z.number().nonnegative().optional(),
	discount: z.number().nonnegative().default(0),
	discountReason: optionalString,
	planId: optionalString,
	/** Day the membership starts; omitted, the day the invoice is paid. */
	startDate: calendarDay.optional(),
	/** Calendar months the membership runs; omitted, planSnapshot.durationInDays. */
	durationMonths: z.number().int().min(1).max(60).optional(),
	planSnapshot: z.object({
		name: z.string().trim().min(1),
		durationInDays: z.number().int().positive(),
		price: z.number().nonnegative(),
		includedCredits: z.number().int().nonnegative(),
	}),
	paymentMethod: z.enum(paymentMethodValues).default(InvoicePaymentMethod.NONE),
	paymentStatus: z
		.enum(["DRAFT", "PENDING"] as [string, ...string[]])
		.default(InvoicePaymentStatus.DRAFT),
	issuedAt: z.string().trim().optional(),
	/**
	 * The branch this invoice is issued at, honoured as sent. Required when
	 * more than one branch is active (resolveLocationId in the controller).
	 */
	locationId: z.string().trim().optional(),
});

export const updateInvoiceStatusBodySchema = z.object({
	paymentStatus: z.enum(paymentStatusValues),
	paymentMethod: z.enum(paymentMethodValues).optional(),
	/** UPI transaction id, card slip number, etc. */
	paymentReference: optionalString,
});

export const idempotencyKeySchema = z.string().trim().min(1).max(200);

export const listInvoicesQuerySchema = z.object({
	paymentStatus: z.enum(paymentStatusValues).optional(),
	userId: z.string().trim().optional(),
	from: z.string().trim().optional(),
	to: z.string().trim().optional(),
});

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;
export type UpdateInvoiceStatusBody = z.infer<
	typeof updateInvoiceStatusBodySchema
>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
