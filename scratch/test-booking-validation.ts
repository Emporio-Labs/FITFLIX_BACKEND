import { bookAppointmentSchema } from "../src/validators/expert-appointment.validator";
import { bookNutritionistBodySchema } from "../src/validators/nutritionist-booking.validator";

function testValidators() {
	console.log("=== Testing bookAppointmentSchema ===");
	
	const validWithEmail = bookAppointmentSchema.safeParse({
		expertType: "nutritionist",
		slotStart: "2026-06-10T09:30:00.000Z",
		timezone: "Asia/Kolkata",
		email: "test@example.com",
	});
	console.log("Valid with email success:", validWithEmail.success);
	if (!validWithEmail.success) console.log(validWithEmail.error);

	const validNoEmail = bookAppointmentSchema.safeParse({
		expertType: "nutritionist",
		slotStart: "2026-06-10T09:30:00.000Z",
		timezone: "Asia/Kolkata",
	});
	console.log("Valid without email success:", validNoEmail.success);
	if (!validNoEmail.success) console.log(validNoEmail.error);

	const invalidEmail = bookAppointmentSchema.safeParse({
		expertType: "nutritionist",
		slotStart: "2026-06-10T09:30:00.000Z",
		timezone: "Asia/Kolkata",
		email: "invalid-email",
	});
	console.log("Invalid email format rejected:", !invalidEmail.success);
	if (invalidEmail.success) {
		console.log("Error: Invalid email was accepted!");
	} else {
		console.log("Rejection details:", invalidEmail.error.issues[0].message);
	}

	console.log("\n=== Testing bookNutritionistBodySchema ===");

	const validNutriWithEmail = bookNutritionistBodySchema.safeParse({
		slotId: "slot_123",
		date: "2026-06-10",
		appointmentMode: "IN_PERSON",
		email: "nutri-test@example.com",
	});
	console.log("Valid nutritionist with email success:", validNutriWithEmail.success);
	if (!validNutriWithEmail.success) console.log(validNutriWithEmail.error);

	const validNutriNoEmail = bookNutritionistBodySchema.safeParse({
		slotId: "slot_123",
		date: "2026-06-10",
		appointmentMode: "IN_PERSON",
	});
	console.log("Valid nutritionist without email success:", validNutriNoEmail.success);
	if (!validNutriNoEmail.success) console.log(validNutriNoEmail.error);

	const invalidNutriEmail = bookNutritionistBodySchema.safeParse({
		slotId: "slot_123",
		date: "2026-06-10",
		appointmentMode: "IN_PERSON",
		email: "bad-email",
	});
	console.log("Invalid nutritionist email rejected:", !invalidNutriEmail.success);
	if (invalidNutriEmail.success) {
		console.log("Error: Invalid nutritionist email was accepted!");
	} else {
		console.log("Rejection details:", invalidNutriEmail.error.issues[0].message);
	}
}

testValidators();
