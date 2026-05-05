import dotenv from "dotenv";
import OpenAI from "openai";
import { z } from "zod";

dotenv.config();

const OPENAI_MODEL = process.env.HPOD_LLM_MODEL ?? "gpt-4o";
const GROK_MODEL = process.env.GROK_LLM_MODEL ?? "grok-2-latest";
const GROK_BASE_URL = process.env.GROK_BASE_URL ?? "https://api.x.ai/v1";
const GROQ_MODEL = process.env.GROQ_LLM_MODEL ?? "openai/gpt-oss-120b";
const GROQ_BASE_URL =
	process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
const LLM_PROVIDER = (process.env.LLM_PROVIDER ?? "openai").toLowerCase();
const MAX_PDF_TEXT_CHARS = Number(process.env.HPOD_MAX_PDF_TEXT_CHARS ?? 60000);

const hpodSummarySchema = z.object({
	patientName: z
		.union([z.string(), z.null()])
		.transform((value) =>
			typeof value === "string" && value.trim() ? value : "Unknown",
		),
	patientEmail: z.string().nullable(),
	patientPhone: z.string().nullable(),
	age: z.string().nullable(),
	gender: z.string().nullable(),
	reportDate: z.string().nullable(),
	vitals: z.object({
		weight_kg: z.number().nullable(),
		height_cm: z.number().nullable(),
		bmi: z.number().nullable(),
		bmi_category: z.string().nullable(),
		spo2_percent: z.number().nullable(),
		body_temperature_f: z.number().nullable(),
		pulse: z.number().nullable(),
		blood_pressure: z.string().nullable(),
	}),
	bodyComposition: z.object({
		body_fat_mass_kg: z.number().nullable(),
		body_fat_percent: z.number().nullable(),
		total_body_water_L: z.number().nullable(),
		protein_kg: z.number().nullable(),
		minerals_kg: z.number().nullable(),
		skeletal_muscle_mass_kg: z.number().nullable(),
		visceral_fat_cm2: z.number().nullable(),
		basal_metabolic_rate_cal: z.number().nullable(),
		intracellular_water_L: z.number().nullable(),
		extracellular_water_L: z.number().nullable(),
	}),
	ecg: z.object({
		pr_interval: z.string().nullable(),
		qrs_interval: z.string().nullable(),
		qtc_interval: z.string().nullable(),
		heart_rate: z.string().nullable(),
	}),
	idealBodyWeight_kg: z.number().nullable(),
	weightToLose_kg: z.number().nullable(),
	testsNotTaken: z.array(z.string()),
	healthInsight: z.string(),
	concerns: z.array(z.string()),
});

export interface HpodSummary {
	patientName: string;
	patientEmail: string | null;
	patientPhone: string | null;
	age: string | null;
	gender: string | null;
	reportDate: string | null;
	vitals: {
		weight_kg: number | null;
		height_cm: number | null;
		bmi: number | null;
		bmi_category: string | null;
		spo2_percent: number | null;
		body_temperature_f: number | null;
		pulse: number | null;
		blood_pressure: string | null;
	};
	bodyComposition: {
		body_fat_mass_kg: number | null;
		body_fat_percent: number | null;
		total_body_water_L: number | null;
		protein_kg: number | null;
		minerals_kg: number | null;
		skeletal_muscle_mass_kg: number | null;
		visceral_fat_cm2: number | null;
		basal_metabolic_rate_cal: number | null;
		intracellular_water_L: number | null;
		extracellular_water_L: number | null;
	};
	ecg: {
		pr_interval: string | null;
		qrs_interval: string | null;
		qtc_interval: string | null;
		heart_rate: string | null;
	};
	idealBodyWeight_kg: number | null;
	weightToLose_kg: number | null;
	testsNotTaken: string[];
	healthInsight: string;
	concerns: string[];
}

const getLlmConfig = (): {
	provider: "openai" | "grok" | "groq";
	client: OpenAI;
	model: string;
} | null => {
	const grokKey = process.env.GROK_API_KEY;
	const groqKey = process.env.GROQ_API_KEY ?? grokKey;
	const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
	const hasGrok = Boolean(grokKey);
	const hasGroq = Boolean(groqKey);

	if (LLM_PROVIDER === "grok" && groqKey?.startsWith("gsk_")) {
		const routedGroqModel =
			process.env.GROQ_LLM_MODEL ??
			(process.env.GROK_LLM_MODEL?.startsWith("openai/")
				? process.env.GROK_LLM_MODEL
				: GROQ_MODEL);

		console.warn(
			"LLM provider is 'grok' but key format is Groq (gsk_). Routing requests to Groq.",
		);
		return {
			provider: "groq",
			client: new OpenAI({
				apiKey: groqKey,
				baseURL: GROQ_BASE_URL,
			}),
			model: routedGroqModel,
		};
	}

	if (LLM_PROVIDER === "groq") {
		if (hasGroq) {
			return {
				provider: "groq",
				client: new OpenAI({
					apiKey: groqKey,
					baseURL: GROQ_BASE_URL,
				}),
				model: GROQ_MODEL,
			};
		}

		if (hasOpenAI) {
			console.warn(
				"LLM provider set to groq but GROQ_API_KEY is missing; falling back to OpenAI.",
			);
			return {
				provider: "openai",
				client: new OpenAI({
					apiKey: process.env.OPENAI_API_KEY,
				}),
				model: OPENAI_MODEL,
			};
		}

		if (hasGrok) {
			console.warn(
				"LLM provider set to groq but GROQ_API_KEY is missing; falling back to Grok.",
			);
			return {
				provider: "grok",
				client: new OpenAI({
					apiKey: grokKey,
					baseURL: GROK_BASE_URL,
				}),
				model: GROK_MODEL,
			};
		}

		return null;
	}

	if (LLM_PROVIDER === "grok") {
		if (hasGrok) {
			return {
				provider: "grok",
				client: new OpenAI({
					apiKey: grokKey,
					baseURL: GROK_BASE_URL,
				}),
				model: GROK_MODEL,
			};
		}

		if (hasOpenAI) {
			console.warn(
				"LLM provider set to grok but GROK_API_KEY is missing; falling back to OpenAI.",
			);
			return {
				provider: "openai",
				client: new OpenAI({
					apiKey: process.env.OPENAI_API_KEY,
				}),
				model: OPENAI_MODEL,
			};
		}

		return null;
	}

	if (hasOpenAI) {
		return {
			provider: "openai",
			client: new OpenAI({
				apiKey: process.env.OPENAI_API_KEY,
			}),
			model: OPENAI_MODEL,
		};
	}

	if (hasGroq) {
		console.warn(
			"OPENAI_API_KEY is missing; falling back to Groq because GROQ/GROK key is set.",
		);
		return {
			provider: "groq",
			client: new OpenAI({
				apiKey: groqKey,
				baseURL: GROQ_BASE_URL,
			}),
			model: GROQ_MODEL,
		};
	}

	if (hasGrok) {
		console.warn(
			"OPENAI_API_KEY is missing; falling back to Grok because GROK_API_KEY is set.",
		);
		return {
			provider: "grok",
			client: new OpenAI({
				apiKey: grokKey,
				baseURL: GROK_BASE_URL,
			}),
			model: GROK_MODEL,
		};
	}

	return null;
};

export const generateHpodSummary = async (
	pdfText: string,
): Promise<HpodSummary | null> => {
	const llmConfig = getLlmConfig();
	if (!llmConfig) {
		console.error(
			"LLM summary error: no API key configured. Set OPENAI_API_KEY, GROQ_API_KEY, or GROK_API_KEY.",
		);
		return null;
	}

	const safePdfText =
		pdfText.length > MAX_PDF_TEXT_CHARS
			? `${pdfText.slice(0, MAX_PDF_TEXT_CHARS)}\n\n[TRUNCATED]`
			: pdfText;

	try {
		const prompt = `
You are a health data extraction assistant for a wellness platform.

Below is raw text extracted from an hPod health screening report PDF.
Extract all available health data and return it as a strict JSON object.

Rules:
- Use null for any value that says "Test Not Taken", "N/A", or is missing
- Do not guess or infer values - only extract what is explicitly stated
- For healthInsight: write 2-3 sentences summarizing the patient's overall health status based on available data
- For concerns: list any metrics that are outside normal range (e.g. low SpO2, high BMI, obesity)
- For testsNotTaken: list the names of tests that explicitly say "Test Not Taken"

Return ONLY valid JSON matching this exact structure, no markdown, no explanation:

{
  "patientName": string | null,
  "patientEmail": string | null,
  "patientPhone": string | null,
  "age": string | null,
  "gender": string | null,
  "reportDate": string | null,
  "vitals": {
    "weight_kg": number | null,
    "height_cm": number | null,
    "bmi": number | null,
    "bmi_category": string | null,
    "spo2_percent": number | null,
    "body_temperature_f": number | null,
    "pulse": number | null,
    "blood_pressure": string | null
  },
  "bodyComposition": {
    "body_fat_mass_kg": number | null,
    "body_fat_percent": number | null,
    "total_body_water_L": number | null,
    "protein_kg": number | null,
    "minerals_kg": number | null,
    "skeletal_muscle_mass_kg": number | null,
    "visceral_fat_cm2": number | null,
    "basal_metabolic_rate_cal": number | null,
    "intracellular_water_L": number | null,
    "extracellular_water_L": number | null
  },
  "ecg": {
    "pr_interval": string | null,
    "qrs_interval": string | null,
    "qtc_interval": string | null,
    "heart_rate": string | null
  },
  "idealBodyWeight_kg": number | null,
  "weightToLose_kg": number | null,
  "testsNotTaken": string[],
  "healthInsight": string,
  "concerns": string[]
}

PDF Report Text:
${safePdfText}
`;

		const response = await llmConfig.client.chat.completions.create({
			model: llmConfig.model,
			messages: [{ role: "user", content: prompt }],
			temperature: 0.1,
			response_format: { type: "json_object" },
		});

		console.log(`LLM summary generated using provider: ${llmConfig.provider}`);

		const raw = response.choices[0]?.message?.content;
		if (!raw) return null;

		const parsed = JSON.parse(raw);
		const validated = hpodSummarySchema.safeParse(parsed);

		if (!validated.success) {
			console.error("LLM summary validation error:", validated.error.flatten());
			return null;
		}

		return validated.data;
	} catch (err) {
		console.error("LLM summary error:", err);
		return null;
	}
};
