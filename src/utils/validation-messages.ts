import type mongoose from "mongoose";
import { z } from "zod";

// Readable validation messages. A schema with no message of its own used to
// answer "Invalid input: expected string, received undefined"; FrontDesk shows
// that text to staff as-is. These say which field is wrong and what it expects.
// A message written on the schema (`.min(1, "...")`) still wins.

const FIELD_LABELS: Record<string, string> = {
	_id: "ID",
	id: "ID",
	phone: "Phone number",
	phoneNumber: "Phone number",
	email: "Email",
	emailAddress: "Email",
	dob: "Date of birth",
	locationId: "Branch",
	homeLocationId: "Home branch",
};

const ACRONYMS = new Set([
	"id",
	"url",
	"bmi",
	"otp",
	"upi",
	"gst",
	"pdf",
	"ip",
]);

const ROOT_LABEL = "Request data";

export const humanizeFieldName = (key: string): string => {
	const known = FIELD_LABELS[key];
	if (known) {
		return known;
	}

	const words = key
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(/[\s_.-]+/)
		.filter(Boolean)
		.map((word) => {
			const lower = word.toLowerCase();
			if (lower === "ids") {
				return "IDs";
			}
			return ACRONYMS.has(lower) ? lower.toUpperCase() : lower;
		});

	if (words.length === 0) {
		return "Value";
	}

	const text = words.join(" ");
	return text.charAt(0).toUpperCase() + text.slice(1);
};

/** `["items", 0, "unitPrice"]` → "Unit price (item 1)". */
export const describeField = (path: readonly PropertyKey[] = []): string => {
	const segments = path.map((segment) =>
		typeof segment === "string" && /^\d+$/.test(segment)
			? Number(segment)
			: segment,
	);
	const name = segments.findLast(
		(segment): segment is string => typeof segment === "string",
	);
	const position = segments.findLast(
		(segment): segment is number => typeof segment === "number",
	);

	if (name === undefined) {
		return position === undefined ? ROOT_LABEL : `Item ${position + 1}`;
	}

	const label = humanizeFieldName(name);
	return position === undefined ? label : `${label} (item ${position + 1})`;
};

const EXPECTED_TYPE: Record<string, string> = {
	string: "text",
	number: "a number",
	int: "a whole number",
	bigint: "a whole number",
	boolean: "true or false",
	date: "a valid date",
	array: "a list",
	tuple: "a list",
	set: "a list",
	object: "an object",
	record: "an object",
	map: "an object",
	file: "a file",
};

const FORMAT_HINTS: Record<string, string> = {
	email: "must be a valid email address",
	url: "must be a valid URL (e.g. https://example.com)",
	uuid: "must be a valid ID",
	guid: "must be a valid ID",
	nanoid: "must be a valid ID",
	cuid: "must be a valid ID",
	cuid2: "must be a valid ID",
	ulid: "must be a valid ID",
	xid: "must be a valid ID",
	ksuid: "must be a valid ID",
	datetime: "must be a date and time (e.g. 2026-10-22T09:30:00Z)",
	date: "must be a date in YYYY-MM-DD format",
	time: "must be a time in HH:mm format",
	duration: "must be a duration (e.g. PT30M)",
	ipv4: "must be a valid IP address",
	ipv6: "must be a valid IP address",
	cidrv4: "must be a valid IP range",
	cidrv6: "must be a valid IP range",
	e164: "must be a phone number with country code (e.g. +919876543210)",
	lowercase: "must be in lowercase",
	uppercase: "must be in uppercase",
	base64: "must be base64 encoded",
	base64url: "must be base64 encoded",
	json_string: "must be valid JSON",
	jwt: "must be a valid token",
	emoji: "must be an emoji",
};

const plural = (count: number | bigint, noun: string): string =>
	`${count} ${noun}${Number(count) === 1 ? "" : "s"}`;

const formatBound = (value: number | bigint, origin: string): string =>
	origin === "date"
		? new Date(Number(value)).toISOString().slice(0, 10)
		: String(value);

const listValues = (values: readonly unknown[]): string =>
	values.map((value) => String(value)).join(", ");

const expectOneOf = (label: string, values: readonly unknown[]): string =>
	values.length === 1
		? `${label} must be ${String(values[0])}`
		: `${label} must be one of: ${listValues(values)}`;

const describeTooSmall = (
	label: string,
	origin: string,
	minimum: number | bigint,
	inclusive: boolean,
	exact: boolean,
): string => {
	switch (origin) {
		case "string":
			if (exact) {
				return `${label} must be exactly ${plural(minimum, "character")}`;
			}
			return Number(minimum) <= 1
				? `${label} is required`
				: `${label} must be at least ${plural(minimum, "character")}`;
		case "array":
		case "set":
			return exact
				? `${label} must have exactly ${plural(minimum, "item")}`
				: `${label} must have at least ${plural(minimum, "item")}`;
		case "date":
			return inclusive
				? `${label} must be on or after ${formatBound(minimum, origin)}`
				: `${label} must be after ${formatBound(minimum, origin)}`;
		case "file":
			return `${label} must be at least ${plural(minimum, "byte")}`;
		default:
			if (exact) {
				return `${label} must be exactly ${minimum}`;
			}
			return inclusive
				? `${label} must be at least ${minimum}`
				: `${label} must be greater than ${minimum}`;
	}
};

const describeTooBig = (
	label: string,
	origin: string,
	maximum: number | bigint,
	inclusive: boolean,
	exact: boolean,
): string => {
	switch (origin) {
		case "string":
			return exact
				? `${label} must be exactly ${plural(maximum, "character")}`
				: `${label} must be at most ${plural(maximum, "character")}`;
		case "array":
		case "set":
			return exact
				? `${label} must have exactly ${plural(maximum, "item")}`
				: `${label} can have at most ${plural(maximum, "item")}`;
		case "date":
			return inclusive
				? `${label} must be on or before ${formatBound(maximum, origin)}`
				: `${label} must be before ${formatBound(maximum, origin)}`;
		case "file":
			return `${label} must be at most ${plural(maximum, "byte")}`;
		default:
			if (exact) {
				return `${label} must be exactly ${maximum}`;
			}
			return inclusive
				? `${label} must be at most ${maximum}`
				: `${label} must be less than ${maximum}`;
	}
};

type FinalizedIssue = {
	code?: string;
	path?: PropertyKey[];
	expected?: unknown;
};

// A union fails as a whole; say what each branch would have taken when every
// branch failed on the value's type (e.g. `z.union([z.string(), z.number()])`).
const describeUnion = (
	label: string,
	branches: readonly (readonly FinalizedIssue[])[],
): string => {
	const expected: string[] = [];
	for (const issues of branches) {
		const [only] = issues;
		if (
			issues.length !== 1 ||
			only?.code !== "invalid_type" ||
			(only.path?.length ?? 0) > 0
		) {
			return `${label} is not in a valid format`;
		}
		const name = EXPECTED_TYPE[String(only.expected)];
		if (!name) {
			return `${label} is not in a valid format`;
		}
		if (!expected.includes(name)) {
			expected.push(name);
		}
	}

	return expected.length > 0
		? `${label} must be ${expected.join(" or ")}`
		: `${label} is not in a valid format`;
};

export const readableZodMessage: z.core.$ZodErrorMap = (issue) => {
	const path = issue.path ?? [];
	const label = describeField(path);

	switch (issue.code) {
		case "invalid_type": {
			if (
				issue.input === undefined ||
				issue.input === null ||
				issue.expected === "nonoptional"
			) {
				// A missing list is usually a plural noun: "Items are required".
				const isList = issue.expected === "array" || issue.expected === "set";
				return isList && /[^su]s$/i.test(label)
					? `${label} are required`
					: `${label} is required`;
			}
			if (["never", "undefined", "void"].includes(issue.expected)) {
				return `${label} is not allowed`;
			}
			const expected = EXPECTED_TYPE[issue.expected];
			return expected
				? `${label} must be ${expected}`
				: `${label} is not in a valid format`;
		}
		case "too_small":
			return describeTooSmall(
				label,
				issue.origin,
				issue.minimum,
				issue.inclusive ?? true,
				issue.exact ?? false,
			);
		case "too_big":
			return describeTooBig(
				label,
				issue.origin,
				issue.maximum,
				issue.inclusive ?? true,
				issue.exact ?? false,
			);
		case "invalid_format": {
			switch (issue.format) {
				case "starts_with":
					return `${label} must start with "${String(issue.prefix)}"`;
				case "ends_with":
					return `${label} must end with "${String(issue.suffix)}"`;
				case "includes":
					return `${label} must contain "${String(issue.includes)}"`;
			}
			const hint = FORMAT_HINTS[issue.format];
			return hint
				? `${label} ${hint}`
				: `${label} is not in the expected format`;
		}
		case "invalid_value":
			return issue.input === undefined
				? `${label} is required`
				: expectOneOf(label, issue.values);
		case "not_multiple_of":
			return issue.divisor === 1
				? `${label} must be a whole number`
				: `${label} must be a multiple of ${issue.divisor}`;
		case "unrecognized_keys": {
			const fields = `${issue.keys.length === 1 ? "field" : "fields"}: ${issue.keys.join(", ")}`;
			return path.length > 0
				? `${label} has unknown ${fields}`
				: `Unknown ${fields}`;
		}
		case "invalid_union": {
			if (issue.input === undefined) {
				return `${label} is required`;
			}
			const discriminator = issue.discriminator;
			const options = issue.options;
			if (typeof discriminator === "string" && Array.isArray(options)) {
				return expectOneOf(describeField([...path, discriminator]), options);
			}
			return describeUnion(label, issue.errors);
		}
		case "invalid_key":
		case "invalid_element":
			return `${label} has an invalid entry`;
		case "custom":
			return `${label} is not valid`;
		default:
			return undefined;
	}
};

export const installReadableValidationMessages = (): void => {
	z.config({ customError: readableZodMessage });
};

const MONGOOSE_CAST_EXPECTATIONS: Record<string, string> = {
	Number: "must be a number",
	Date: "must be a valid date",
	Boolean: "must be true or false",
	String: "must be text",
};

// Mongoose's own templates ("Path `phone` is required.", "Cast to Number
// failed ...") name the schema path in backticks; a message a model wrote
// itself does not, and is kept.
const isMongooseDefaultMessage = (message: string): boolean =>
	/path `|^Cast to /i.test(message);

export const readableMongooseMessage = (
	path: string,
	entry: mongoose.Error.ValidatorError | mongoose.Error.CastError,
): string => {
	if (
		typeof entry.message === "string" &&
		!isMongooseDefaultMessage(entry.message)
	) {
		return entry.message;
	}

	const label = describeField(path.split("."));

	if (entry.name === "CastError") {
		return entry.kind === "ObjectId"
			? `${label} is not valid`
			: `${label} ${MONGOOSE_CAST_EXPECTATIONS[entry.kind] ?? "is not in the expected format"}`;
	}

	const properties = ("properties" in entry ? entry.properties : {}) as Record<
		string,
		unknown
	>;
	const bound = (key: string): string => {
		const value = properties[key];
		return value instanceof Date
			? value.toISOString().slice(0, 10)
			: String(value);
	};

	switch (entry.kind) {
		case "required":
			return `${label} is required`;
		case "enum":
			return Array.isArray(properties.enumValues)
				? expectOneOf(label, properties.enumValues)
				: `${label} is not an allowed value`;
		case "min":
			return `${label} must be at least ${bound("min")}`;
		case "max":
			return `${label} must be at most ${bound("max")}`;
		case "minlength":
			return `${label} must be at least ${bound("minlength")} characters`;
		case "maxlength":
			return `${label} must be at most ${bound("maxlength")} characters`;
		case "regexp":
			return `${label} is not in the expected format`;
		default:
			return `${label} is not valid`;
	}
};
