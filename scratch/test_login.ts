async function testLogin() {
	try {
		const res = await fetch("http://localhost:3000/auth/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "user@fitflix.com",
				password: "User@12345",
			}),
		});

		const data = await res.json();
		console.log("Login HTTP Status:", res.status);
		console.log("Login Response Body:", JSON.stringify(data, null, 2));
	} catch (err) {
		console.error("Login request failed:", err);
	}
}

await testLogin();
