import PDFDocument from "pdfkit";

type InvoiceItem = {
	name: string;
	price: number;
	quantity: number;
};

type PlanSnapshot = {
	name: string;
	durationInDays: number;
	price: number;
	includedCredits: number;
};

type UserRef = {
	username?: string;
	email?: string;
	phone?: string;
};

type InvoiceData = {
	invoiceNumber: string;
	userId: UserRef | unknown;
	items: InvoiceItem[];
	subtotal: number;
	tax: number;
	discount: number;
	total: number;
	planSnapshot: PlanSnapshot;
	paymentStatus: string;
	paymentMethod: string;
	issuedAt?: Date | null;
	paidAt?: Date | null;
	createdAt?: Date;
};

const fmt = (amount: number): string =>
	`INR ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDate = (date: Date | null | undefined): string => {
	if (!date) return "—";
	return new Date(date).toLocaleDateString("en-IN", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
};

export const buildInvoicePdf = (invoice: InvoiceData): PDFKit.PDFDocument => {
	const doc = new PDFDocument({ size: "A4", margin: 50 });

	const user = invoice.userId as UserRef;
	const GRAY = "#6b7280";
	const DARK = "#111827";
	const ACCENT = "#f97316";
	const LINE = "#e5e7eb";

	// ── Header ────────────────────────────────────────────────────────────────
	doc.fontSize(24).fillColor(ACCENT).font("Helvetica-Bold").text("FITFLIX", 50, 50);
	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Health & Fitness Platform", 50, 78);

	doc
		.fontSize(20)
		.fillColor(DARK)
		.font("Helvetica-Bold")
		.text("INVOICE", 0, 50, { align: "right" });
	doc
		.fontSize(9)
		.fillColor(GRAY)
		.font("Helvetica")
		.text(invoice.invoiceNumber, 0, 76, { align: "right" });

	doc.moveTo(50, 100).lineTo(545, 100).strokeColor(LINE).lineWidth(1).stroke();

	// ── Bill To / Invoice Info ────────────────────────────────────────────────
	const col2 = 350;
	let y = 115;

	doc.fontSize(8).fillColor(GRAY).font("Helvetica-Bold").text("BILLED TO", 50, y);
	doc.fontSize(8).fillColor(GRAY).font("Helvetica-Bold").text("INVOICE DETAILS", col2, y);

	y += 14;
	doc
		.fontSize(10)
		.fillColor(DARK)
		.font("Helvetica-Bold")
		.text(user?.username ?? "—", 50, y);
	doc.fontSize(9).fillColor(DARK).font("Helvetica").text(`Plan: ${invoice.planSnapshot.name}`, col2, y);

	y += 14;
	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text(user?.email ?? "—", 50, y);
	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text(`Issued: ${formatDate(invoice.issuedAt)}`, col2, y);

	y += 13;
	if (user?.phone) {
		doc.fontSize(9).fillColor(GRAY).font("Helvetica").text(user.phone, 50, y);
	}
	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text(`Paid: ${formatDate(invoice.paidAt)}`, col2, y);

	y += 13;
	doc
		.fontSize(9)
		.fillColor(GRAY)
		.font("Helvetica")
		.text(
			`Duration: ${invoice.planSnapshot.durationInDays} days  •  Credits: ${invoice.planSnapshot.includedCredits}`,
			col2,
			y,
		);

	y += 25;
	doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(0.5).stroke();

	// ── Items Table Header ────────────────────────────────────────────────────
	y += 10;
	doc.rect(50, y, 495, 20).fillColor("#f9fafb").fill();
	doc
		.fontSize(8)
		.fillColor(GRAY)
		.font("Helvetica-Bold")
		.text("DESCRIPTION", 58, y + 6)
		.text("QTY", 360, y + 6, { width: 50, align: "right" })
		.text("UNIT PRICE", 415, y + 6, { width: 70, align: "right" })
		.text("AMOUNT", 490, y + 6, { width: 50, align: "right" });

	y += 22;

	// ── Items ─────────────────────────────────────────────────────────────────
	for (const item of invoice.items) {
		const lineTotal = item.price * item.quantity;
		doc
			.fontSize(9)
			.fillColor(DARK)
			.font("Helvetica")
			.text(item.name, 58, y, { width: 295 })
			.text(String(item.quantity), 360, y, { width: 50, align: "right" })
			.text(fmt(item.price), 415, y, { width: 70, align: "right" })
			.text(fmt(lineTotal), 490, y, { width: 50, align: "right" });

		y += 18;
		doc.moveTo(50, y - 2).lineTo(545, y - 2).strokeColor(LINE).lineWidth(0.3).stroke();
	}

	// ── Totals ────────────────────────────────────────────────────────────────
	y += 8;
	const totalsX = 380;

	const addTotalRow = (label: string, value: string, bold = false, color = DARK) => {
		doc
			.fontSize(9)
			.fillColor(GRAY)
			.font(bold ? "Helvetica-Bold" : "Helvetica")
			.text(label, totalsX, y, { width: 100 });
		doc.fontSize(9).fillColor(color).font(bold ? "Helvetica-Bold" : "Helvetica").text(value, 490, y, {
			width: 50,
			align: "right",
		});
		y += 16;
	};

	addTotalRow("Subtotal", fmt(invoice.subtotal));
	if (invoice.tax > 0) addTotalRow("Tax", fmt(invoice.tax));
	if (invoice.discount > 0) addTotalRow("Discount", `-${fmt(invoice.discount)}`);

	doc.moveTo(totalsX, y - 4).lineTo(545, y - 4).strokeColor(LINE).lineWidth(0.5).stroke();
	addTotalRow("TOTAL", fmt(invoice.total), true, ACCENT);

	// ── Payment Info ──────────────────────────────────────────────────────────
	y += 10;
	doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(0.5).stroke();
	y += 12;

	doc.fontSize(8).fillColor(GRAY).font("Helvetica-Bold").text("PAYMENT INFORMATION", 50, y);
	y += 14;

	const statusColor =
		invoice.paymentStatus === "PAID"
			? "#16a34a"
			: invoice.paymentStatus === "PENDING"
				? "#d97706"
				: invoice.paymentStatus === "CANCELLED" || invoice.paymentStatus === "FAILED"
					? "#dc2626"
					: GRAY;

	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Status:", 50, y);
	doc.fontSize(9).fillColor(statusColor).font("Helvetica-Bold").text(invoice.paymentStatus, 110, y);

	doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Method:", col2, y);
	doc
		.fontSize(9)
		.fillColor(DARK)
		.font("Helvetica")
		.text(invoice.paymentMethod.replace("_", " "), col2 + 60, y);

	// ── Footer ────────────────────────────────────────────────────────────────
	doc
		.fontSize(8)
		.fillColor(GRAY)
		.font("Helvetica")
		.text("Thank you for choosing Fitflix.", 50, 760, { align: "center", width: 495 })
		.text("For queries, contact support@fitflix.in", 50, 772, { align: "center", width: 495 });

	doc.end();
	return doc;
};
