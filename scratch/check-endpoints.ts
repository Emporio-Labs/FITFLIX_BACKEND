import { config } from "dotenv";
config();

async function check() {
	const apiKey = process.env.ACTIVEX_API_KEY;
	const baseUrl = process.env.ACTIVEX_BASE_URL ?? "https://api.activex.ai/external/bca";
	console.log("Testing URL:", baseUrl);
	console.log("API Key:", apiKey);

	const endpoints = [
		"https://api.activex.ai/external/bca",
		"https://api.activex.ai/api/external/bca",
		"https://api.activex.ai/v1/external/bca",
		"https://api.activex.ai/external/bca-data",
		"https://api.activex.ai/bca",
		"https://api.activex.ai/api/v1/external/bca",
	];

	for (const url of endpoints) {
		try {
			const res = await fetch(url, {
				method: "POST",
				headers: {
					"x-api-key": apiKey!,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					Date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
					PhoneNumbers: ["+91-8822777333"],
				}),
			});
			const text = await res.text();
			console.log(`URL: ${url} -> Status: ${res.status} ${res.statusText}`);
			console.log(`Body: ${text.slice(0, 300)}\n`);
		} catch (e: any) {
			console.log(`URL: ${url} -> Error: ${e.message}\n`);
		}
	}
}

check();
