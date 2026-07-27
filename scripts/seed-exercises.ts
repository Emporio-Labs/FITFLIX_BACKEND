import { config } from "dotenv";
import mongoose from "mongoose";
import {
	ExerciseDifficulty,
	ExerciseSection,
	MuscleGroup,
} from "../src/models/Enums";
import Exercise from "../src/models/Exercise";
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
		targetedMuscles: [
			"Anterior Deltoids",
			"Lateral Deltoids",
			"Triceps",
			"Upper Chest",
		],
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
		targetedMuscles: [
			"Latissimus Dorsi",
			"Biceps",
			"Rhomboids",
			"Rear Deltoids",
		],
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
		targetedMuscles: [
			"Rectus Abdominis",
			"Transverse Abdominis",
			"Obliques",
			"Erector Spinae",
		],
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
	{
		name: "Push Ups",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Pectoralis Major", "Triceps", "Anterior Deltoids", "Core"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Start in a high plank with hands slightly wider than shoulder-width. Keep your body in a straight line from head to heels. Lower your chest toward the floor by bending your elbows at about 45 degrees, then press back up to full arm extension.",
		commonMistakes: [
			"Sagging hips",
			"Flaring elbows out to 90 degrees",
			"Partial range of motion",
			"Craning the neck forward",
		],
		tips: [
			"Squeeze your glutes and brace your core",
			"Lower until your chest nearly touches the floor",
			"Drop to your knees to regress, elevate feet to progress",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Incline Dumbbell Press",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Upper Pectoralis", "Anterior Deltoids", "Triceps"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Dumbbells & Incline Bench",
		instructions:
			"Set a bench to a 30-45 degree incline. Sit back with a dumbbell in each hand at shoulder level, palms facing forward. Press the dumbbells up and slightly together until your arms are extended, then lower them under control back to shoulder level.",
		commonMistakes: [
			"Setting the incline too steep",
			"Arching the lower back excessively",
			"Clanging the dumbbells at the top",
		],
		tips: [
			"Keep your feet planted and shoulder blades retracted",
			"Lower the weights slowly for more chest activation",
			"A 30-degree incline hits the upper chest best",
		],
		caloriesPerSet: 10,
		isSystem: true,
	},
	{
		name: "Chest Dips",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Lower Pectoralis", "Triceps", "Anterior Deltoids"],
		difficulty: ExerciseDifficulty.Advanced,
		equipment: "Dip Bars",
		instructions:
			"Grip parallel dip bars and lift yourself to arms' length. Lean your torso slightly forward and lower your body by bending your elbows until your shoulders are just below your elbows. Press back up to the start without locking out harshly.",
		commonMistakes: [
			"Staying too upright (shifts load to triceps)",
			"Descending too fast",
			"Shrugging the shoulders",
		],
		tips: [
			"Lean forward about 30 degrees to target the chest",
			"Keep elbows tracking at roughly 45 degrees",
			"Use band assistance if full dips are too hard",
		],
		caloriesPerSet: 10,
		isSystem: true,
	},
	{
		name: "Cable Crossover",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Pectoralis Major", "Anterior Deltoids"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Cable Machine",
		instructions:
			"Stand between two high pulleys holding a handle in each hand. Step forward with a slight forward lean and a soft bend in your elbows. Pull both handles down and across your body in a wide arc until your hands meet in front of your chest, then return under control.",
		commonMistakes: [
			"Bending the elbows during the movement",
			"Using too much weight and jerking",
			"Standing too upright",
		],
		tips: [
			"Imagine hugging a barrel",
			"Pause and squeeze when your hands meet",
			"Keep a staggered stance for balance",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Bent Over Barbell Row",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Latissimus Dorsi", "Rhomboids", "Trapezius", "Biceps"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Barbell",
		instructions:
			"Hold a barbell with an overhand grip, hands shoulder-width apart. Hinge at the hips until your torso is about 45 degrees to the floor, back flat. Pull the bar toward your lower ribs, squeezing your shoulder blades together, then lower it under control.",
		commonMistakes: [
			"Rounding the lower back",
			"Standing too upright",
			"Using momentum to heave the bar",
		],
		tips: [
			"Keep your core braced and neck neutral",
			"Lead the pull with your elbows",
			"Pause briefly at the top of each rep",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Lat Pulldown",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Latissimus Dorsi", "Biceps", "Rhomboids"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Lat Pulldown Machine",
		instructions:
			"Sit at the machine with thighs secured under the pads. Grip the bar wider than shoulder-width with palms facing away. Pull the bar down to your upper chest while keeping your torso mostly upright, then let the bar rise slowly to full arm extension.",
		commonMistakes: [
			"Pulling the bar behind the neck",
			"Leaning back excessively",
			"Using arms instead of back",
		],
		tips: [
			"Drive your elbows down toward your hips",
			"Squeeze your lats at the bottom",
			"Keep your chest lifted throughout",
		],
		caloriesPerSet: 9,
		isSystem: true,
	},
	{
		name: "Seated Cable Row",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Rhomboids", "Latissimus Dorsi", "Trapezius", "Biceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Cable Row Machine",
		instructions:
			"Sit with feet on the platform and knees slightly bent. Grip the handle with both hands and sit tall. Pull the handle to your stomach while squeezing your shoulder blades together, then extend your arms back out under control.",
		commonMistakes: [
			"Rocking the torso back and forth",
			"Shrugging the shoulders",
			"Rounding the back at the stretch",
		],
		tips: [
			"Keep your torso upright and still",
			"Think about pinching a pencil between your shoulder blades",
			"Full stretch, full squeeze on every rep",
		],
		caloriesPerSet: 9,
		isSystem: true,
	},
	{
		name: "Single Arm Dumbbell Row",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Latissimus Dorsi", "Rhomboids", "Rear Deltoids", "Biceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbell & Bench",
		instructions:
			"Place one knee and the same-side hand on a bench, other foot on the floor. Hold a dumbbell in your free hand with your arm extended. Row the dumbbell up to your hip, keeping your elbow close to your body, then lower it slowly.",
		commonMistakes: [
			"Rotating the torso to lift the weight",
			"Pulling the dumbbell to the chest instead of the hip",
			"Rounding the back",
		],
		tips: [
			"Keep your back flat like a tabletop",
			"Pull with your back, not your arm",
			"Complete all reps on one side before switching",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Lateral Raises",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Lateral Deltoids"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells",
		instructions:
			"Stand with a dumbbell in each hand at your sides, palms facing in. With a slight bend in your elbows, raise both arms out to the sides until they reach shoulder height, then lower them slowly back down.",
		commonMistakes: [
			"Swinging the weights up",
			"Raising above shoulder height",
			"Shrugging the traps",
		],
		tips: [
			"Lead with your elbows, not your hands",
			"Tilt the dumbbells slightly forward like pouring water",
			"Use lighter weight than you think you need",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Front Raises",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Anterior Deltoids", "Upper Chest"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells",
		instructions:
			"Stand holding dumbbells in front of your thighs, palms facing your body. Keeping your arms straight with a soft elbow bend, raise one or both dumbbells forward to shoulder height, then lower under control.",
		commonMistakes: [
			"Using momentum from the hips",
			"Raising above eye level",
			"Arching the lower back",
		],
		tips: [
			"Brace your core to prevent leaning back",
			"Alternate arms to reduce cheating",
			"Control the lowering phase",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Arnold Press",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Anterior Deltoids", "Lateral Deltoids", "Triceps"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Dumbbells",
		instructions:
			"Sit or stand holding dumbbells at shoulder height with palms facing you. As you press the weights overhead, rotate your palms outward so they face forward at the top. Reverse the rotation as you lower back to the start.",
		commonMistakes: [
			"Rushing the rotation",
			"Arching the back at the top",
			"Not completing the full rotation",
		],
		tips: [
			"Keep the movement smooth and continuous",
			"Use a seated bench with back support for stability",
			"Slightly lighter weight than a standard press",
		],
		caloriesPerSet: 9,
		isSystem: true,
	},
	{
		name: "Face Pulls",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Rear Deltoids", "Rhomboids", "Rotator Cuff"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Cable Machine & Rope",
		instructions:
			"Set a cable pulley at face height with a rope attachment. Grip the rope with both hands, palms facing in. Pull the rope toward your face, flaring your elbows out and squeezing your shoulder blades together, then return under control.",
		commonMistakes: [
			"Using too much weight",
			"Pulling to the chest instead of the face",
			"Letting shoulders roll forward",
		],
		tips: [
			"Aim your thumbs toward your ears at the end of the pull",
			"Great for posture and shoulder health",
			"Keep the reps slow and controlled",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Dumbbell Shrugs",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Trapezius", "Levator Scapulae"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells",
		instructions:
			"Stand tall holding heavy dumbbells at your sides. Elevate your shoulders straight up toward your ears as high as possible, pause briefly, then lower them fully back down.",
		commonMistakes: [
			"Rolling the shoulders in circles",
			"Bending the elbows to lift",
			"Using a partial range of motion",
		],
		tips: [
			"Move straight up and down, not in circles",
			"Hold the top position for 1-2 seconds",
			"Keep your neck relaxed",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Tricep Pushdowns",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Triceps Brachii"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Cable Machine",
		instructions:
			"Stand facing a high cable pulley with a bar or rope attachment. Grip it with elbows pinned to your sides. Push the attachment down until your arms are fully extended, squeeze the triceps, then let it rise back to chest height under control.",
		commonMistakes: [
			"Letting elbows drift away from the body",
			"Leaning over the weight",
			"Cutting the range of motion short",
		],
		tips: [
			"Keep your elbows glued to your ribs",
			"Squeeze hard at full extension",
			"With a rope, spread the ends apart at the bottom",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Overhead Tricep Extension",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Triceps Brachii (Long Head)"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbell",
		instructions:
			"Hold one dumbbell with both hands and press it overhead. Keeping your upper arms close to your head, lower the dumbbell behind your head by bending your elbows, then extend back to the top.",
		commonMistakes: [
			"Flaring the elbows out wide",
			"Arching the lower back",
			"Lowering the weight too fast",
		],
		tips: [
			"Keep elbows pointing forward, not sideways",
			"Brace your core to protect your lower back",
			"Feel the deep stretch at the bottom",
		],
		caloriesPerSet: 7,
		isSystem: true,
	},
	{
		name: "Hammer Curls",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Brachialis", "Biceps Brachii", "Brachioradialis"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbells",
		instructions:
			"Stand holding dumbbells at your sides with palms facing your body (neutral grip). Curl the weights up toward your shoulders while keeping the neutral grip, then lower slowly back down.",
		commonMistakes: [
			"Swinging the torso",
			"Rotating the wrists during the curl",
			"Letting elbows travel forward",
		],
		tips: [
			"Keep the thumbs-up grip throughout",
			"Great for forearm and grip strength",
			"Control the eccentric for 2-3 seconds",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Preacher Curls",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Biceps Brachii", "Brachialis"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Preacher Bench & EZ Bar",
		instructions:
			"Sit at a preacher bench with your upper arms resting on the pad. Grip an EZ bar with an underhand grip. Curl the bar up toward your shoulders, then lower it until your arms are almost fully extended.",
		commonMistakes: [
			"Lifting the elbows off the pad",
			"Bouncing at the bottom",
			"Not extending fully",
		],
		tips: [
			"The pad eliminates cheating — use lighter weight",
			"Stop just short of full lockout at the bottom",
			"Keep your wrists neutral",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Skull Crushers",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Triceps Brachii"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "EZ Bar & Bench",
		instructions:
			"Lie on a flat bench holding an EZ bar with arms extended above your chest. Keeping your upper arms stationary, bend your elbows to lower the bar toward your forehead, then extend your arms back to the start.",
		commonMistakes: [
			"Moving the upper arms",
			"Flaring the elbows",
			"Lowering the bar to the chest instead of the head",
		],
		tips: [
			"Keep elbows tucked and pointing at the ceiling",
			"Lower the bar slightly behind your head for a better stretch",
			"Use a spotter when going heavy",
		],
		caloriesPerSet: 7,
		isSystem: true,
	},
	{
		name: "Romanian Deadlifts",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hamstrings", "Glutes", "Erector Spinae"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Barbell or Dumbbells",
		instructions:
			"Stand holding a barbell in front of your thighs. With a slight knee bend, hinge at the hips and push your glutes back, lowering the bar along your legs until you feel a deep hamstring stretch. Drive your hips forward to return to standing.",
		commonMistakes: [
			"Rounding the back",
			"Bending the knees too much (turning it into a squat)",
			"Letting the bar drift away from the legs",
		],
		tips: [
			"Think 'hips back', not 'bend down'",
			"Keep the bar dragging along your thighs and shins",
			"Squeeze your glutes hard at the top",
		],
		caloriesPerSet: 14,
		isSystem: true,
	},
	{
		name: "Leg Extensions",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Leg Extension Machine",
		instructions:
			"Sit in the machine with the pad on your shins just above the ankles. Grip the side handles, then extend your knees to raise the pad until your legs are straight. Squeeze your quads at the top, then lower under control.",
		commonMistakes: [
			"Using momentum to kick the weight up",
			"Lifting hips off the seat",
			"Dropping the weight on the way down",
		],
		tips: [
			"Pause for a second at full extension",
			"Point your toes slightly out or in to bias different quad heads",
			"Adjust the seat so your knees align with the machine's pivot",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Lying Leg Curls",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hamstrings", "Calves"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Leg Curl Machine",
		instructions:
			"Lie face down on the machine with the pad against the back of your ankles. Curl your heels toward your glutes as far as possible, squeeze, then lower the weight slowly back to the start.",
		commonMistakes: [
			"Lifting the hips off the pad",
			"Using a jerky, fast tempo",
			"Partial range of motion",
		],
		tips: [
			"Keep your hips pressed into the bench",
			"Squeeze your hamstrings at the top of each rep",
			"Slow negatives build the most strength",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Standing Calf Raises",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Gastrocnemius", "Soleus"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Calf Raise Machine or Step",
		instructions:
			"Stand with the balls of your feet on an elevated surface, heels hanging off. Lower your heels below the platform for a full stretch, then rise up onto your toes as high as possible. Pause at the top, then lower slowly.",
		commonMistakes: [
			"Bouncing at the bottom",
			"Cutting the range of motion short",
			"Rushing the reps",
		],
		tips: [
			"Pause 1-2 seconds at both the top and bottom",
			"Keep your knees straight but not locked",
			"Add weight once bodyweight becomes easy",
		],
		caloriesPerSet: 6,
		isSystem: true,
	},
	{
		name: "Hip Thrusts",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Glutes", "Hamstrings", "Core"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Bench & Barbell",
		instructions:
			"Sit on the floor with your upper back against a bench and a barbell across your hips. Plant your feet flat, then drive through your heels to lift your hips until your torso is parallel to the floor. Squeeze your glutes at the top, then lower with control.",
		commonMistakes: [
			"Overarching the lower back at the top",
			"Pushing through the toes",
			"Not reaching full hip extension",
		],
		tips: [
			"Tuck your chin and keep ribs down",
			"Use a pad on the bar for comfort",
			"Pause and squeeze for 1-2 seconds at lockout",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Bulgarian Split Squats",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Hamstrings"],
		difficulty: ExerciseDifficulty.Advanced,
		equipment: "Bench & Dumbbells (optional)",
		instructions:
			"Stand a few feet in front of a bench and place the top of your rear foot on it. Lower your back knee toward the floor while keeping your front shin mostly vertical, then drive through your front heel to stand back up.",
		commonMistakes: [
			"Standing too close to the bench",
			"Letting the front knee cave inward",
			"Leaning too far forward",
		],
		tips: [
			"Find your distance with bodyweight before adding load",
			"Keep most of your weight on the front leg",
			"Hold dumbbells at your sides to progress",
		],
		caloriesPerSet: 12,
		isSystem: true,
	},
	{
		name: "Goblet Squats",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Core"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Dumbbell or Kettlebell",
		instructions:
			"Hold a dumbbell or kettlebell vertically against your chest with both hands. Stand with feet slightly wider than shoulder-width. Squat down between your knees keeping your chest tall, then drive through your heels to stand.",
		commonMistakes: [
			"Letting the weight pull you forward",
			"Heels lifting off the floor",
			"Collapsing the chest",
		],
		tips: [
			"Keep your elbows inside your knees at the bottom",
			"Great squat-form teacher for beginners",
			"Sit 'between' your legs, not 'behind' them",
		],
		caloriesPerSet: 10,
		isSystem: true,
	},
	{
		name: "Crunches",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Rectus Abdominis"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie on your back with knees bent and feet flat on the floor. Place your hands lightly behind your head. Curl your shoulders off the floor by contracting your abs, pause briefly, then lower back down without letting your head rest.",
		commonMistakes: [
			"Pulling on the neck",
			"Using momentum",
			"Coming up too high (turning it into a sit-up)",
		],
		tips: [
			"Imagine bringing your ribs to your hips",
			"Exhale as you crunch up",
			"Keep your lower back pressed into the floor",
		],
		caloriesPerSet: 5,
		isSystem: true,
	},
	{
		name: "Bicycle Crunches",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Obliques", "Rectus Abdominis", "Hip Flexors"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie on your back with hands behind your head and legs raised, knees bent at 90 degrees. Bring your right elbow toward your left knee while extending your right leg, then switch sides in a pedaling motion.",
		commonMistakes: [
			"Pulling on the neck",
			"Rushing through reps",
			"Elbows doing the work instead of the torso",
		],
		tips: [
			"Rotate from your torso, not your arms",
			"Fully extend the straight leg each rep",
			"Slow and controlled beats fast and sloppy",
		],
		caloriesPerSet: 7,
		isSystem: true,
	},
	{
		name: "Hanging Leg Raises",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Lower Abdominals", "Hip Flexors", "Grip"],
		difficulty: ExerciseDifficulty.Advanced,
		equipment: "Pull-up Bar",
		instructions:
			"Hang from a pull-up bar with an overhand grip. Keeping your legs straight (or knees bent to regress), raise your legs until they are parallel to the floor or higher, then lower them slowly without swinging.",
		commonMistakes: [
			"Swinging and using momentum",
			"Arching the lower back",
			"Dropping the legs too fast",
		],
		tips: [
			"Tilt your pelvis up at the top for full ab engagement",
			"Start with bent-knee raises and progress to straight legs",
			"Control the descent completely",
		],
		caloriesPerSet: 8,
		isSystem: true,
	},
	{
		name: "Side Plank",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Obliques", "Transverse Abdominis", "Glute Medius"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie on your side with your forearm on the floor, elbow under your shoulder. Stack your feet and lift your hips so your body forms a straight line from head to feet. Hold, then switch sides.",
		commonMistakes: [
			"Letting the hips sag",
			"Rolling the shoulders forward",
			"Holding the breath",
		],
		tips: [
			"Push the floor away with your forearm",
			"Squeeze your glutes to keep the line straight",
			"Drop your bottom knee to regress",
		],
		caloriesPerSet: 4,
		isSystem: true,
	},
	{
		name: "Burpees",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Chest", "Quadriceps", "Core", "Shoulders"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "None",
		instructions:
			"From standing, squat down and place your hands on the floor. Kick your feet back into a plank, perform a push-up, jump your feet back to your hands, then explode up into a jump with arms overhead.",
		commonMistakes: [
			"Sagging hips in the plank",
			"Skipping the push-up",
			"Landing stiff-legged from the jump",
		],
		tips: [
			"Move at a steady, sustainable pace",
			"Step back instead of jumping to regress",
			"Land softly with bent knees",
		],
		caloriesPerSet: 15,
		isSystem: true,
	},
	{
		name: "Kettlebell Swings",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Glutes", "Hamstrings", "Core", "Shoulders"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "Kettlebell",
		instructions:
			"Stand with feet shoulder-width apart, kettlebell on the floor in front of you. Hinge at the hips to grip it with both hands, hike it back between your legs, then snap your hips forward to swing the bell to chest height. Let it swing back down and repeat rhythmically.",
		commonMistakes: [
			"Squatting instead of hinging",
			"Lifting with the arms and shoulders",
			"Rounding the back",
		],
		tips: [
			"The power comes from your hips, not your arms",
			"Keep your lats engaged and the bell close on the backswing",
			"Stand tall and squeeze glutes at the top",
		],
		caloriesPerSet: 14,
		isSystem: true,
	},
	//
	// =========================
	// WARM UP EXERCISES
	// =========================
	//

	{
		name: "Jumping Jacks",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Shoulders", "Legs", "Core"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Jump while spreading your legs and raising your arms overhead. Return to starting position and repeat continuously.",
		commonMistakes: ["Landing too hard", "Not maintaining rhythm"],
		tips: ["Stay light on your feet", "Keep breathing steady"],
		caloriesPerSet: 8,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "High Knees",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Calves", "Core"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions: "Run in place while lifting your knees as high as possible.",
		commonMistakes: ["Leaning too far back", "Slow pace"],
		tips: ["Pump your arms for rhythm", "Stay on the balls of your feet"],
		caloriesPerSet: 10,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Arm Circles",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Deltoids", "Rotator Cuff"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions: "Extend arms sideways and rotate them in small circles.",
		commonMistakes: ["Moving too fast", "Shrugging shoulders"],
		tips: ["Keep arms straight", "Control the movement"],
		caloriesPerSet: 3,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Bodyweight Lunges",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Hamstrings"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Step forward and lower your hips until both knees form 90-degree angles.",
		commonMistakes: ["Knee going past toes", "Leaning forward excessively"],
		tips: ["Keep chest upright", "Push through your heel"],
		caloriesPerSet: 7,
		isSystem: true,
		sectionTypes: ["warmup", "workout"],
	},

	{
		name: "Butt Kicks",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hamstrings", "Calves", "Quadriceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Jog in place while kicking your heels up toward your glutes with each step. Keep a quick, light rhythm and pump your arms naturally.",
		commonMistakes: ["Leaning forward", "Landing heavily on the heels"],
		tips: ["Stay tall through your torso", "Increase speed gradually"],
		caloriesPerSet: 9,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Leg Swings",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hip Flexors", "Hamstrings", "Glutes"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Hold onto a wall for balance and swing one leg forward and backward in a controlled arc. Complete all reps, then switch legs. Repeat with side-to-side swings.",
		commonMistakes: ["Swinging too aggressively", "Rounding the back"],
		tips: [
			"Increase the range gradually with each swing",
			"Keep your torso upright and core engaged",
		],
		caloriesPerSet: 4,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Hip Circles",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Hip Flexors", "Glutes", "Obliques"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand with hands on your hips and feet shoulder-width apart. Rotate your hips in large circles clockwise, then reverse direction.",
		commonMistakes: ["Moving the knees instead of the hips", "Rushing"],
		tips: ["Make the circles as wide as comfortable", "Keep feet planted"],
		caloriesPerSet: 3,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Torso Twists",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Obliques", "Lower Back", "Spinal Erectors"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand with feet shoulder-width apart and arms bent in front of your chest. Rotate your torso side to side in a smooth, continuous rhythm, letting your arms swing naturally.",
		commonMistakes: ["Twisting from the knees", "Jerky, fast rotations"],
		tips: ["Keep hips facing forward", "Rotate from the waist up"],
		caloriesPerSet: 3,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Shoulder Rolls",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Trapezius", "Deltoids", "Rhomboids"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand tall with arms relaxed at your sides. Roll your shoulders up, back, and down in a smooth circular motion. After the set, reverse the direction.",
		commonMistakes: ["Hunching forward", "Moving too fast"],
		tips: ["Make full, slow circles", "Breathe deeply as you roll"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Ankle Circles",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Ankles", "Calves", "Tibialis Anterior"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand on one leg (hold a wall for balance) and lift the other foot slightly off the ground. Rotate the raised ankle in slow circles, then reverse direction and switch feet.",
		commonMistakes: ["Circles too small", "Moving the whole leg"],
		tips: ["Isolate the movement to the ankle joint", "Great before running or jumping"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Walking Knee Hugs",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Glutes", "Hip Flexors", "Hamstrings"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Step forward and pull one knee up to your chest with both hands, rising onto the toes of your standing leg. Release, step forward, and repeat on the other side.",
		commonMistakes: ["Rounding the back to reach the knee", "Losing balance by rushing"],
		tips: ["Stand tall as you hug the knee", "Pause briefly at the top of each hug"],
		caloriesPerSet: 4,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Inchworms",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Hamstrings", "Core", "Shoulders", "Chest"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"From standing, hinge forward and place your hands on the floor. Walk your hands out into a high plank, pause, then walk your feet toward your hands and stand back up.",
		commonMistakes: ["Bending the knees excessively", "Sagging hips in the plank"],
		tips: [
			"Keep your legs as straight as flexibility allows",
			"Add a push-up in the plank position to progress",
		],
		caloriesPerSet: 7,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Jump Rope",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Calves", "Shoulders", "Core", "Forearms"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Jump Rope",
		instructions:
			"Hold the rope handles at hip height and swing the rope overhead using your wrists. Jump just high enough to clear the rope, landing softly on the balls of your feet.",
		commonMistakes: ["Jumping too high", "Swinging from the shoulders instead of the wrists"],
		tips: ["Keep elbows close to your ribs", "Find a steady rhythm before speeding up"],
		caloriesPerSet: 12,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Bodyweight Squats",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps", "Glutes", "Hamstrings", "Core"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand with feet shoulder-width apart, toes slightly out. Sit your hips back and down until your thighs are parallel to the floor, keeping your chest up, then drive through your heels to stand.",
		commonMistakes: ["Knees caving inward", "Heels lifting off the floor", "Shallow depth"],
		tips: [
			"Extend your arms forward for counterbalance",
			"Keep your weight in your mid-foot and heels",
		],
		caloriesPerSet: 8,
		isSystem: true,
		sectionTypes: ["warmup", "workout"],
	},

	{
		name: "Mountain Climbers",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Core", "Hip Flexors", "Shoulders", "Quadriceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Start in a high plank with hands under your shoulders. Drive one knee toward your chest, then quickly switch legs in a running motion while keeping your hips level.",
		commonMistakes: ["Bouncing the hips up and down", "Hands drifting forward of the shoulders"],
		tips: ["Keep your core braced the whole time", "Start slow and build speed"],
		caloriesPerSet: 10,
		isSystem: true,
		sectionTypes: ["warmup", "workout"],
	},

	{
		name: "World's Greatest Stretch",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Hip Flexors", "Hamstrings", "Thoracic Spine", "Glutes"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "None",
		instructions:
			"From a push-up position, step one foot outside the same-side hand into a deep lunge. Drop the opposite elbow toward the floor, then rotate that arm up toward the ceiling, following it with your gaze. Return and repeat on the other side.",
		commonMistakes: [
			"Letting the back knee sag to the floor",
			"Rotating from the arm instead of the torso",
		],
		tips: [
			"Keep the front heel planted throughout",
			"Exhale as you rotate and reach upward",
		],
		caloriesPerSet: 5,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	{
		name: "Side Shuffles",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Glutes", "Quadriceps", "Adductors", "Calves"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand in a quarter squat with feet shoulder-width apart. Shuffle sideways several steps in one direction, staying low, then shuffle back the other way.",
		commonMistakes: ["Standing up too tall", "Crossing the feet"],
		tips: ["Stay low in the athletic stance", "Keep your chest up and eyes forward"],
		caloriesPerSet: 8,
		isSystem: true,
		sectionTypes: ["warmup"],
	},

	//
	// =========================
	// STRETCHING EXERCISES
	// =========================
	//

	{
		name: "Hamstring Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hamstrings"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Extend one leg and lean forward gently until you feel a stretch in the back of the thigh.",
		commonMistakes: ["Rounding the back", "Bouncing during stretch"],
		tips: ["Breathe slowly", "Hold stretch steadily"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Quad Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Quadriceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand on one leg and pull the opposite foot toward your glutes.",
		commonMistakes: ["Pulling too aggressively", "Leaning forward"],
		tips: ["Keep knees close together", "Use support if needed"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Child Pose",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Lower Back", "Shoulders"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Sit back onto your heels and stretch your arms forward on the floor.",
		commonMistakes: ["Holding tension in shoulders"],
		tips: ["Relax your breathing", "Sink hips backward gently"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Cobra Stretch",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Abdominals", "Lower Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie face down and push your chest upward while keeping hips grounded.",
		commonMistakes: ["Overextending lower back"],
		tips: ["Keep shoulders relaxed", "Lift gradually"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Butterfly Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Adductors", "Hip Flexors", "Groin"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Sit on the floor with the soles of your feet together and knees dropped out to the sides. Hold your feet and gently lean forward from the hips until you feel a stretch in your inner thighs.",
		commonMistakes: ["Bouncing the knees", "Rounding the spine to lean forward"],
		tips: ["Press elbows lightly on the thighs to deepen", "Keep your back long and tall"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Hip Flexor Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hip Flexors", "Quadriceps", "Psoas"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Kneel on one knee with the other foot planted in front, both knees at 90 degrees. Tuck your pelvis and shift your hips forward until you feel a stretch in the front of the rear hip. Switch sides.",
		commonMistakes: ["Arching the lower back", "Letting the front knee drift past the toes"],
		tips: ["Squeeze the glute of the kneeling leg", "Raise the same-side arm overhead to deepen"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Standing Calf Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Gastrocnemius", "Soleus", "Achilles Tendon"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Wall",
		instructions:
			"Face a wall and place both hands on it. Step one foot back, keeping that leg straight and heel pressed into the floor. Lean into the wall until you feel a stretch in the rear calf. Switch legs.",
		commonMistakes: ["Lifting the back heel", "Turning the back foot outward"],
		tips: ["Keep the back foot pointing straight ahead", "Bend the back knee slightly to hit the soleus"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Figure Four Stretch",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Glutes", "Piriformis", "Hips"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie on your back with knees bent. Cross one ankle over the opposite thigh, then pull the supporting thigh toward your chest until you feel a stretch deep in the glute. Switch sides.",
		commonMistakes: ["Lifting the head and shoulders off the floor", "Forcing the crossed knee down"],
		tips: ["Keep the crossed foot flexed to protect the knee", "Breathe into the stretch and relax"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Pigeon Pose",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Glutes", "Hip Flexors", "Piriformis"],
		difficulty: ExerciseDifficulty.Intermediate,
		equipment: "None",
		instructions:
			"From all fours, bring one knee forward and place it behind your wrist with the shin angled across your body. Extend the other leg straight back, square your hips, and fold your torso forward over the front leg. Switch sides.",
		commonMistakes: ["Collapsing onto one hip", "Forcing the front shin fully parallel"],
		tips: ["Place a cushion under the front hip if needed", "Keep the back leg extending straight behind you"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Cross-Body Shoulder Stretch",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Posterior Deltoids", "Rhomboids", "Upper Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Bring one arm straight across your chest. Use the opposite hand or forearm to gently pull it closer until you feel a stretch in the back of the shoulder. Switch arms.",
		commonMistakes: ["Shrugging the stretched shoulder", "Pulling at the elbow joint"],
		tips: ["Keep both shoulders down and relaxed", "Pull on the upper arm, not the elbow"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Neck Stretch",
		muscleGroup: MuscleGroup.Shoulders,
		targetedMuscles: ["Trapezius", "Levator Scapulae", "Neck"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Sit or stand tall. Gently tilt your head toward one shoulder, using the same-side hand to apply light pressure, until you feel a stretch along the opposite side of your neck. Switch sides.",
		commonMistakes: ["Pulling too hard on the head", "Raising the opposite shoulder"],
		tips: ["Keep the opposite shoulder pressed down", "Move slowly — the neck needs gentle handling"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Triceps Stretch",
		muscleGroup: MuscleGroup.Arms,
		targetedMuscles: ["Triceps", "Latissimus Dorsi", "Shoulders"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Raise one arm overhead and bend the elbow so your hand drops behind your neck. Use the opposite hand to gently press the bent elbow back and down. Switch arms.",
		commonMistakes: ["Arching the lower back", "Forcing the elbow too far"],
		tips: ["Keep your core engaged and ribs down", "Lean slightly to the side to deepen the stretch"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Doorway Chest Stretch",
		muscleGroup: MuscleGroup.Chest,
		targetedMuscles: ["Pectoralis Major", "Anterior Deltoids", "Biceps"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "Doorway",
		instructions:
			"Stand in a doorway with your forearm on the frame, elbow bent at 90 degrees at shoulder height. Step forward with one foot until you feel a stretch across your chest and front shoulder. Switch sides.",
		commonMistakes: ["Placing the arm too high", "Twisting the torso away"],
		tips: ["Keep your shoulder blade pulled back", "Adjust elbow height to change where you feel it"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Seated Spinal Twist",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Spinal Erectors", "Obliques", "Glutes"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Sit with both legs extended. Cross one foot over the opposite thigh, then rotate your torso toward the bent knee, using the opposite elbow against the knee for gentle leverage. Switch sides.",
		commonMistakes: ["Rounding the spine", "Forcing the rotation"],
		tips: ["Sit tall and lengthen the spine before twisting", "Exhale as you rotate deeper"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Cat-Cow Stretch",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Spinal Erectors", "Abdominals", "Neck"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Start on all fours with hands under shoulders and knees under hips. Inhale as you drop your belly and lift your gaze (cow), then exhale as you round your spine toward the ceiling and tuck your chin (cat). Flow between the two positions.",
		commonMistakes: ["Moving only the neck", "Rushing between positions"],
		tips: ["Sync the movement with your breath", "Move through the entire spine, not just the lower back"],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["warmup", "stretching"],
	},

	{
		name: "Downward Dog",
		muscleGroup: MuscleGroup.FullBody,
		targetedMuscles: ["Hamstrings", "Calves", "Shoulders", "Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"From all fours, tuck your toes and lift your hips up and back to form an inverted V. Press your hands into the floor, lengthen your spine, and reach your heels toward the ground.",
		commonMistakes: ["Rounding the back to force heels down", "Collapsing through the shoulders"],
		tips: ["Bend your knees to keep the spine long", "Pedal the feet to warm up the calves"],
		caloriesPerSet: 3,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Seated Forward Fold",
		muscleGroup: MuscleGroup.Legs,
		targetedMuscles: ["Hamstrings", "Calves", "Lower Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Sit with both legs extended straight in front of you. Hinge forward from the hips, reaching toward your toes while keeping your spine as long as possible. Hold where you feel a comfortable stretch.",
		commonMistakes: ["Rounding the spine to reach further", "Bouncing"],
		tips: [
			"Lead with your chest, not your head",
			"Bend the knees slightly if your hamstrings are tight",
		],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Thread the Needle",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Thoracic Spine", "Shoulders", "Upper Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Start on all fours. Slide one arm under your body, palm up, until your shoulder and ear rest on the floor. Hold the stretch in your upper back and shoulder, then return and switch sides.",
		commonMistakes: ["Collapsing the hips to one side", "Forcing the shoulder down"],
		tips: [
			"Keep your hips stacked over your knees",
			"Reach the sliding arm as far as comfortable",
		],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Supine Spinal Twist",
		muscleGroup: MuscleGroup.Back,
		targetedMuscles: ["Spinal Erectors", "Obliques", "Glutes", "Lower Back"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Lie on your back with arms out to the sides. Bring one knee toward your chest, then guide it across your body toward the floor on the opposite side, keeping both shoulders grounded. Switch sides.",
		commonMistakes: ["Lifting the opposite shoulder off the floor", "Forcing the knee to the ground"],
		tips: [
			"Let gravity do the work — relax into the twist",
			"Turn your head away from the knee to deepen the stretch",
		],
		caloriesPerSet: 2,
		isSystem: true,
		sectionTypes: ["stretching"],
	},

	{
		name: "Standing Side Stretch",
		muscleGroup: MuscleGroup.Core,
		targetedMuscles: ["Obliques", "Latissimus Dorsi", "Intercostals"],
		difficulty: ExerciseDifficulty.Beginner,
		equipment: "None",
		instructions:
			"Stand tall with feet together and clasp your hands overhead. Keeping both feet grounded, lean your torso to one side until you feel a stretch along the opposite side of your body. Switch sides.",
		commonMistakes: ["Leaning forward or backward", "Lifting the opposite heel"],
		tips: ["Reach up and over, not just sideways", "Keep hips square and stable"],
		caloriesPerSet: 1,
		isSystem: true,
		sectionTypes: ["stretching"],
	},
];

async function seed() {
	// Guard against duplicate names inside the seed list itself.
	const seen = new Set<string>();
	for (const exercise of systemExercises) {
		const key = exercise.name.trim().toLowerCase();
		if (seen.has(key)) {
			throw new Error(`Duplicate exercise in seed data: "${exercise.name}"`);
		}
		seen.add(key);
	}

	console.log("Connecting to database...");
	await connectDB();

	console.log(`Seeding ${systemExercises.length} system exercises...`);

	const ops = systemExercises.map((exercise) => {
		// Strength exercises omit sectionTypes — default them to ["workout"]
		// so every seeded doc has an explicit, filterable section.
		const sectionTypes: ExerciseSection[] =
			"sectionTypes" in exercise && Array.isArray(exercise.sectionTypes)
				? (exercise.sectionTypes as ExerciseSection[])
				: [ExerciseSection.Workout];
		return {
			updateOne: {
				filter: { name: exercise.name, isSystem: true },
				update: { $set: { ...exercise, sectionTypes } },
				upsert: true,
			},
		};
	});

	const result = await Exercise.bulkWrite(ops);
	console.log(
		`Seed complete: ${result.upsertedCount} created, ${result.modifiedCount} updated`,
	);

	// Remove duplicate system exercises (same name, case-insensitive),
	// keeping the most recently updated copy — i.e. the one this seed
	// just wrote.
	console.log("Checking for duplicate system exercises...");
	const duplicateGroups: Array<{
		_id: string;
		docs: Array<{ id: mongoose.Types.ObjectId; updatedAt?: Date }>;
	}> = await Exercise.aggregate([
		{ $match: { isSystem: true } },
		{
			$group: {
				_id: { $toLower: { $trim: { input: "$name" } } },
				docs: { $push: { id: "$_id", updatedAt: "$updatedAt" } },
				count: { $sum: 1 },
			},
		},
		{ $match: { count: { $gt: 1 } } },
	]);

	let removedCount = 0;
	for (const group of duplicateGroups) {
		const sorted = [...group.docs].sort(
			(a, b) =>
				new Date(b.updatedAt ?? 0).getTime() -
				new Date(a.updatedAt ?? 0).getTime(),
		);
		const idsToDelete = sorted.slice(1).map((doc) => doc.id);
		const deleted = await Exercise.deleteMany({ _id: { $in: idsToDelete } });
		removedCount += deleted.deletedCount;
		console.log(
			`  Removed ${deleted.deletedCount} duplicate(s) of "${group._id}"`,
		);
	}
	console.log(
		removedCount > 0
			? `Duplicate cleanup complete: ${removedCount} removed`
			: "No duplicates found.",
	);

	await mongoose.disconnect();
	console.log("Done.");
}

seed().catch((error) => {
	console.error("Seed failed:", error);
	process.exit(1);
});
