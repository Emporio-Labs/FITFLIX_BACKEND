import z from "zod";
import { InvoicePaymentMethod, InvoicePaymentStatus } from "../models/Enums";

const paymentStatusValues = Object.values(InvoicePaymentStatus) as [string, ...string[]];
const paymentMethodValues = Object.values(InvoicePaymentMethod) as [string, ...string[]];

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

export const createInvoiceBodySchema = z.object({
	userId: z.string().trim().optional(),
	leadId: z.string().trim().optional(),
	items: z
		.array(
			z.object({
				name: z.string().trim().min(1),
				price: z.number().nonnegative(),
				quantity: z.number().int().positive(),
			}),
		)
		.min(1, "At least one item is required"),
	tax: z.number().nonnegative().default(0),
	discount: z.number().nonnegative().default(0),
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
});

export const updateInvoiceStatusBodySchema = z.object({
	paymentStatus: z.enum(paymentStatusValues),
	paymentMethod: z.enum(paymentMethodValues).optional(),
});

export const listInvoicesQuerySchema = z.object({
	paymentStatus: z.enum(paymentStatusValues).optional(),
	userId: z.string().trim().optional(),
	from: z.string().trim().optional(),
	to: z.string().trim().optional(),
});

export type CreateInvoiceBody = z.infer<typeof createInvoiceBodySchema>;
export type UpdateInvoiceStatusBody = z.infer<typeof updateInvoiceStatusBodySchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
