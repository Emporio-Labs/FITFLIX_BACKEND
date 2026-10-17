/**
 * Post-processing for workbooks written by SheetJS Community Edition, which
 * cannot emit data validation (drop-downs), frozen panes or cell styles.
 *
 * An .xlsx is a ZIP of XML parts; SheetJS bundles a ZIP reader/writer
 * (`XLSX.CFB`), so this opens the package, patches the worksheet and style
 * XML, and re-zips — no extra dependency.
 *
 * Assumes the layout SheetJS produces: sheets are `xl/worksheets/sheet{N}.xml`
 * in workbook order, `<sheetView workbookViewId="0"/>` is self-closing, and
 * styles.xml holds a single default font/fill/xf.
 */
import XLSX from "xlsx";

export type CellStyle = "header" | "required" | "title";

/** cellXfs index for each style; appended after SheetJS's default xf 0. */
const STYLE_XF: Record<CellStyle, number> = {
	header: 1,
	required: 2,
	title: 3,
};

export interface DataValidation {
	/** Target range, e.g. "B2:B2001". */
	sqref: string;
	type: "list" | "whole" | "decimal" | "textLength";
	/** List source ("'Allowed Values'!$A$2:$A$4") or the minimum. */
	formula1: string;
	/** Maximum for `between`. */
	formula2?: string;
	operator?: "between" | "lessThanOrEqual";
	errorStyle?: "stop" | "warning";
	promptTitle?: string;
	prompt?: string;
	errorTitle?: string;
	error?: string;
}

export interface SheetEnhancement {
	validations?: DataValidation[];
	/** Number of top rows to freeze. */
	freezeRows?: number;
	/** A1-style cell reference → style. Only cells that exist are styled. */
	styles?: Record<string, CellStyle>;
}

const escapeXml = (value: string) =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** Excel caps prompt/error text at 255 and titles at 32 characters. */
const clip = (value: string, max: number) =>
	value.length > max ? `${value.slice(0, max - 1)}…` : value;

const validationXml = (v: DataValidation): string => {
	const attrs: string[] = [`type="${v.type}"`, 'allowBlank="1"'];
	if (v.type !== "list") attrs.push(`operator="${v.operator ?? "between"}"`);
	if (v.errorStyle && v.errorStyle !== "stop") {
		attrs.push(`errorStyle="${v.errorStyle}"`);
	}
	attrs.push('showInputMessage="1"', 'showErrorMessage="1"');
	if (v.errorTitle)
		attrs.push(`errorTitle="${escapeXml(clip(v.errorTitle, 32))}"`);
	if (v.error) attrs.push(`error="${escapeXml(clip(v.error, 255))}"`);
	if (v.promptTitle)
		attrs.push(`promptTitle="${escapeXml(clip(v.promptTitle, 32))}"`);
	if (v.prompt) attrs.push(`prompt="${escapeXml(clip(v.prompt, 255))}"`);
	attrs.push(`sqref="${v.sqref}"`);
	const f2 =
		v.formula2 === undefined
			? ""
			: `<formula2>${escapeXml(v.formula2)}</formula2>`;
	return `<dataValidation ${attrs.join(" ")}><formula1>${escapeXml(v.formula1)}</formula1>${f2}</dataValidation>`;
};

/**
 * Elements that the OOXML schema orders *after* <dataValidations>; the block
 * goes before whichever of these appears first.
 */
const AFTER_VALIDATIONS = [
	"<hyperlinks",
	"<printOptions",
	"<pageMargins",
	"<pageSetup",
	"<headerFooter",
	"<rowBreaks",
	"<colBreaks",
	"<customProperties",
	"<cellWatches",
	"<ignoredErrors",
	"<smartTags",
	"<drawing",
	"<legacyDrawing",
	"<picture",
	"<oleObjects",
	"<controls",
	"<webPublishItems",
	"<tableParts",
	"<extLst",
	"</worksheet>",
];

const patchSheet = (xml: string, e: SheetEnhancement): string => {
	let out = xml;

	if (e.freezeRows && e.freezeRows > 0) {
		const n = e.freezeRows;
		out = out.replace(
			'<sheetView workbookViewId="0"/>',
			`<sheetView workbookViewId="0"><pane ySplit="${n}" topLeftCell="A${n + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${n + 1}" sqref="A${n + 1}"/></sheetView>`,
		);
	}

	for (const [ref, style] of Object.entries(e.styles ?? {})) {
		out = out.replace(
			new RegExp(`<c r="${ref}"(?=[ >])`),
			`<c r="${ref}" s="${STYLE_XF[style]}"`,
		);
	}

	if (e.validations && e.validations.length > 0) {
		const block = `<dataValidations count="${e.validations.length}">${e.validations.map(validationXml).join("")}</dataValidations>`;
		const at = AFTER_VALIDATIONS.map((tag) => out.indexOf(tag))
			.filter((i) => i >= 0)
			.reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);
		if (Number.isFinite(at)) out = out.slice(0, at) + block + out.slice(at);
	}

	return out;
};

/** Bold header (grey), bold required header (amber), large bold title. */
const patchStyles = (xml: string): string =>
	xml
		.replace(
			/<fonts count="1">(<font>.*?<\/font>)<\/fonts>/,
			(_m, base: string) =>
				`<fonts count="3">${base}<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font><font><b/><sz val="14"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>`,
		)
		.replace(
			/<fills count="2">(.*?)<\/fills>/,
			(_m, base: string) =>
				`<fills count="4">${base}<fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDE68A"/><bgColor indexed="64"/></patternFill></fill></fills>`,
		)
		.replace(
			/<cellXfs count="1">(.*?)<\/cellXfs>/,
			(_m, base: string) =>
				`<cellXfs count="4">${base}<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>`,
		);

const findEntry = (zip: ReturnType<typeof XLSX.CFB.read>, path: string) =>
	XLSX.CFB.find(zip, `/${path}`) ?? XLSX.CFB.find(zip, path);

const readText = (entry: { content: unknown }) =>
	Buffer.from(entry.content as Uint8Array).toString("utf8");

/**
 * Apply `enhancements` (keyed by 1-based sheet position) to an .xlsx buffer.
 * Unknown sheets are skipped; styles are only registered when some sheet
 * asks for them.
 */
export function enhanceXlsx(
	buffer: Buffer,
	enhancements: Record<number, SheetEnhancement>,
): Buffer {
	const zip = XLSX.CFB.read(buffer, { type: "buffer" });

	let usesStyles = false;
	for (const [index, e] of Object.entries(enhancements)) {
		const entry = findEntry(zip, `xl/worksheets/sheet${index}.xml`);
		if (!entry) continue;
		if (e.styles && Object.keys(e.styles).length > 0) usesStyles = true;
		entry.content = Buffer.from(patchSheet(readText(entry), e), "utf8");
	}

	if (usesStyles) {
		const styles = findEntry(zip, "xl/styles.xml");
		if (styles) {
			styles.content = Buffer.from(patchStyles(readText(styles)), "utf8");
		}
	}

	return Buffer.from(
		XLSX.CFB.write(zip, {
			type: "buffer",
			fileType: "zip",
			compression: true,
		}) as Uint8Array,
	);
}
