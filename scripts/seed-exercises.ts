import { config } from "dotenv";
import mongoose from "mongoose";
import Exercise from "../src/models/Exercise";
import { ExerciseDifficulty, MuscleGroup } from "../src/models/Enums";
import connectDB from "../src/utils/db";

config();

const systemExercises = [
	{
		name: "Bench Press",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Pectoralis Major", "Anterior Deltoids", "Triceps"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Barbell & Bench",
		instructions:
			"Lie flat on a bench with your feet firmly on the ground. Grip the barbell slightly wider than shoulder-width apart. Unrack the bar and lower it slowly to your mid-chest, keeping your elbows at about a 45-degree angle. Press the bar back up to full arm extension, exhaling as you push. Keep your back flat on the bench throughout the movement.",
		commonMistakes: [
			"Bouncing the bar off the chest",
			"Flaring elbows too wide",
			"Lifting hips off the bench",
			"Not using a full range of motion",
		],
		tips: [
			"Keep your wrists straight and aligned with forearms",
			"Drive through your feet for stability",
			"Control the descent — don't let gravity do the work",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Barbell Squats",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Hamstrings", "Core"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Barbell & Squat Rack",
		instructions:
			"Position the barbell on your upper back (not your neck). Stand with feet shoulder-width apart, toes slightly pointed out. Brace your core, then bend at the hips and knees simultaneously. Lower until your thighs are at least parallel to the ground. Drive through your heels to stand back up, keeping your chest up throughout.",
		commonMistakes: [
			"Knees caving inward",
			"Rising onto toes",
			"Rounding the lower back",
			"Not reaching proper depth",
		],
		tips: [
			"Keep your chest up and look straight ahead",
			"Push your knees out over your toes",
			"Breathe in on the way down, out on the way up",
		],
		caloriesPerSet: 15,
		isSystem: true,
	},
	{
		name: "Deadlifts",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: [
			"Erector Spinae",
			"Glutes",
			"Hamstrings",
			"Trapezius",
			"Forearms",
		],
		difficulty: ExerciseDifficulty.Advanced,
		equipment: "Barbell",
		instructions:
			"Stand with feet hip-width apart, barbell over mid-foot. Bend at the hips and knees to grip the bar just outside your legs. Flatten your back, brace your core, and drive through your heels to lift the bar. Keep the bar close to your body as you stand up. Reverse the movement to lower the bar back to the ground.",
		commonMistakes: [
			"Rounding the back",
			"Starting with hips too high",
			"Letting the bar drift away from the body",
			"Jerking the weight off the floor",
		],
		tips: [
			"Think of it as pushing the floor away",
			"Engage your lats to keep the bar close",
			"Lock out by squeezing your glutes at the top",
		],
		caloriesPerSet: 18,
		isSystem: true,
	},
	{
		name: "Overhead Press",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Anterior Deltoids", "Lateral Deltoids", "Triceps", "Upper Chest"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Barbell or Dumbbells",
		instructions:
			"Stand with feet shoulder-width apart. Hold the barbell at shoulder height with hands just outside shoulder width. Brace your core and press the bar straight overhead until your arms are fully extended. Lower the bar back to shoulder height under control.",
		commonMistakes: [
			"Excessive lower back arch",
			"Pressing the bar too far forward",
			"Not fully locking out at the top",
		],
		tips: [
			"Squeeze your glutes and brace your abs",
			"Move your head slightly back as the bar passes, then forward once overhead",
			"Keep the bar path as vertical as possible",
		],
		caloriesPerSet: 10,
		isSystem: true,
	},
	{
		name: "Pull Ups",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Latissimus Dorsi", "Biceps", "Rhomboids", "Rear Deltoids"],
		difficulty: ExerciseDifficulty.Advanced,
		equipment: "Pull-up Bar",
		instructions:
			"Hang from a pull-up bar with an overhand grip, hands slightly wider than shoulder-width apart. Engage your core and pull yourself up by driving your elbows down and back until your chin clears the bar. Lower yourself slowly to a full hang.",
		commonMistakes: [
			"Using momentum or kipping",
			"Not going through full range of motion",
			"Shrugging shoulders to ears",
		],
		tips: [
			"Focus on pulling with your elbows, not your hands",
			"Keep your core tight to prevent swinging",
			"If you can't do full pull-ups, start with negatives or band-assisted",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Plank Hold",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Rectus Abdominis", "Transverse Abdominis", "Obliques", "Erector Spinae"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Start in a push-up position, then lower onto your forearms. Keep your body in a straight line from head to heels. Engage your core by pulling your belly button toward your spine. Hold the position for the prescribed duration.",
		commonMistakes: [
			"Letting hips sag",
			"Raising hips too high",
			"Holding breath",
			"Looking up instead of down",
		],
		tips: [
			"Imagine squeezing a walnut between your shoulder blades",
			"Breathe steadily throughout the hold",
			"Squeeze your quads and glutes for extra stability",
		],
		caloriesPerSet: 5,
		isSystem: true,
	},
	{
		name: "Bicep Curls",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Biceps Brachii", "Brachialis", "Forearms"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells",
		instructions:
			"Stand with feet shoulder-width apart, holding a dumbbell in each hand with arms fully extended and palms facing forward. Keeping your upper arms stationary, curl the weights up toward your shoulders. Squeeze at the top, then lower slowly back to the starting position.",
		commonMistakes: [
			"Swinging the body for momentum",
			"Moving the elbows forward",
			"Going too fast on the lowering phase",
		],
		tips: [
			"Keep your elbows pinned to your sides",
			"Control the negative — 2-3 seconds down",
			"Don't fully relax at the bottom, maintain tension",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Dumbbell Flyes",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Pectoralis Major", "Anterior Deltoids"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells & Bench",
		instructions:
			"Lie on a flat bench holding dumbbells above your chest with palms facing each other and a slight bend in your elbows. Lower the dumbbells out to the sides in a wide arc until you feel a stretch in your chest. Bring the dumbbells back together above your chest using the same arc motion.",
		commonMistakes: [
			"Straightening the arms completely",
			"Going too heavy and losing control",
			"Lowering the weights too far below the bench",
		],
		tips: [
			"Maintain the slight bend in your elbows throughout",
			"Think of hugging a large tree",
			"Focus on the stretch and squeeze of your chest",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Leg Press",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Hamstrings"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Leg Press Machine",
		instructions:
			"Sit in the leg press machine with your back flat against the pad. Place your feet shoulder-width apart on the platform. Release the safety handles and lower the platform by bending your knees until they reach about 90 degrees. Press through your heels to extend your legs back to the starting position without locking your knees.",
		commonMistakes: [
			"Locking knees at the top",
			"Letting knees cave inward",
			"Placing feet too low on the platform",
			"Lifting hips off the seat",
		],
		tips: [
			"Adjust foot placement to target different muscles",
			"Higher feet = more glute and hamstring focus",
			"Keep a controlled tempo throughout",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Russian Twists",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Obliques", "Rectus Abdominis", "Hip Flexors"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Medicine Ball (optional)",
		instructions:
			"Sit on the floor with your knees bent and feet slightly elevated. Lean back slightly to engage your core while maintaining a straight spine. Hold a medicine ball (or clasp your hands) in front of your chest. Rotate your torso to the right, bringing the weight beside your hip, then rotate to the left. Each left-right rotation counts as one rep.",
		commonMistakes: [
			"Rounding the back",
			"Moving only the arms instead of the torso",
			"Going too fast and losing control",
		],
		tips: [
			"Keep your chest up and shoulders back",
			"Move deliberately — quality over speed",
			"Elevate your feet for added difficulty",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
];

async function seed() {
	console.log("Connecting to database...");
	await connectDB();

	console.log("Seeding system exercises...");

	const ops = systemExercises.map((exercise) => ({
		updateOne: {
			filter: { name: exercise.name, isSystem: true },
			update: { $set: exercise },
			upsert: true,
		},
	}));

	const result = await Exercise.bulkWrite(ops);
	console.log(
		`Seed complete: ${result.upsertedCount} created, ${result.modifiedCount} updated`,
	);

	await mongoose.disconnect();
	console.log("Done.");
}

seed().catch((error) => {
	console.error("Seed failed:", error);
	process.exit(1);
});
