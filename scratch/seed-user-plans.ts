import { config } from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User";
import NutritionFood from "../src/models/nutrition-food.model";
import UserNutritionPlan from "../src/models/nutrition-plan.model";
import connectDB from "../src/utils/db";
import { NutritionGoal, NutritionPlanStatus, MealType, NutritionFoodSource } from "../src/models/Enums";

config();

async function main() {
  try {
    await connectDB();
    console.log("Connected to MongoDB.");

    // 1. Get or create a base food item for valid reference IDs
    let baseFood = await NutritionFood.findOne();
    if (!baseFood) {
      console.log("No foods found in catalog. Seeding a system base food item...");
      baseFood = await NutritionFood.create({
        name: "Standard Base Ingredient",
        source: NutritionFoodSource.System,
        caloriesKcal: 100,
        proteinG: 10,
        carbsG: 15,
        fatG: 2,
        basePer: 100,
        servingLabel: "100 g",
        isActive: true,
      });
      console.log(`Created base food: ${baseFood.name} (${baseFood._id})`);
    } else {
      console.log(`Using existing base food: ${baseFood.name} (${baseFood._id})`);
    }

    const users = await User.find({});
    console.log(`Found ${users.length} users in the system.`);

    const foodId = baseFood._id;

    // Define the meal templates for the 7-day rotation plan
    const buildMeals = () => [
      {
        mealType: MealType.Breakfast,
        name: "Peanut butterProtein smoothie",
        timeOfDay: "08:00 AM",
        notes: "Consume immediately post-hydration",
        prepTimeMinutes: 10,
        items: [
          { foodId, foodName: "Frozen Banana", quantityG: 100, caloriesKcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
          { foodId, foodName: "Organic Peanut Butter", quantityG: 15, caloriesKcal: 94, proteinG: 3.8, carbsG: 3.0, fatG: 8.1 },
          { foodId, foodName: "Unsweetened Almond Milk", quantityG: 200, caloriesKcal: 30, proteinG: 1.0, carbsG: 1.0, fatG: 2.5 }
        ]
      },
      {
        mealType: MealType.Lunch,
        name: "Peri peri Chicken salad",
        timeOfDay: "01:30 PM",
        notes: "Perform lean protein sizing",
        prepTimeMinutes: 15,
        items: [
          { foodId, foodName: "Grilled Chicken Breast", quantityG: 120, caloriesKcal: 198, proteinG: 37.0, carbsG: 0.0, fatG: 4.3 },
          { foodId, foodName: "Organic Green Lettuce", quantityG: 80, caloriesKcal: 12, proteinG: 1.0, carbsG: 2.0, fatG: 0.2 },
          { foodId, foodName: "Peri Peri Sauce Dressing", quantityG: 15, caloriesKcal: 45, proteinG: 1.0, carbsG: 2.0, fatG: 3.5 },
          { foodId, foodName: "Cold-Pressed Olive Oil", quantityG: 10, caloriesKcal: 88, proteinG: 0.0, carbsG: 0.0, fatG: 10.0 }
        ]
      },
      {
        mealType: MealType.Snack,
        name: "ABC Juice",
        timeOfDay: "04:30 PM",
        notes: "Drink fresh within 15 minutes of extraction",
        prepTimeMinutes: 10,
        items: [
          { foodId, foodName: "Green Apple", quantityG: 100, caloriesKcal: 52, proteinG: 0.3, carbsG: 14.0, fatG: 0.2 },
          { foodId, foodName: "Fresh Beetroot", quantityG: 50, caloriesKcal: 22, proteinG: 0.8, carbsG: 5.0, fatG: 0.1 },
          { foodId, foodName: "Organic Carrot", quantityG: 50, caloriesKcal: 20, proteinG: 0.5, carbsG: 5.0, fatG: 0.1 }
        ]
      },
      {
        mealType: MealType.Dinner,
        name: "Chicken sandwich",
        timeOfDay: "08:30 PM",
        notes: "Use whole grain or high-fiber sourdough",
        prepTimeMinutes: 15,
        items: [
          { foodId, foodName: "Lean Shredded Chicken", quantityG: 80, caloriesKcal: 132, proteinG: 25.0, carbsG: 0.0, fatG: 2.9 },
          { foodId, foodName: "Whole Wheat Bread Slices", quantityG: 60, caloriesKcal: 150, proteinG: 6.0, carbsG: 28.0, fatG: 1.5 },
          { foodId, foodName: "Mixed Salad Veggies", quantityG: 50, caloriesKcal: 20, proteinG: 1.0, carbsG: 4.0, fatG: 0.1 }
        ]
      }
    ];

    const daysArray = [];
    for (let dayNum = 1; dayNum <= 7; dayNum++) {
      daysArray.push({
        dayNumber: dayNum,
        meals: buildMeals()
      });
    }

    // Assign to each user
    for (const u of users) {
      // Clean up any old plan first to start fresh
      await UserNutritionPlan.deleteMany({ userId: u._id });

      // We'll set the startDate to 2 days ago so they land on "Day 3" of the 7-day protocol
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const plan = await UserNutritionPlan.create({
        userId: u._id,
        nutritionistId: u._id, // Self-assigning nutritionist role for mock simplicity
        name: "Anabolic Recomposition Plan",
        goal: NutritionGoal.MuscleGain,
        status: NutritionPlanStatus.Active,
        startDate: twoDaysAgo,
        durationDays: 7,
        targetCaloriesKcal: 3200,
        targetMacros: {
          proteinG: 180,
          carbsG: 320,
          fatG: 90,
          fiberG: 35,
          sugarG: 0
        },
        days: daysArray,
        lifestyleRecommendations: [
          { title: "Hydration", description: "Drink at least 3.5L water daily.", category: "Lifestyle" },
          { title: "Sleep Adherence", description: "Maintain 7-8 hours of deep sleep.", category: "Recovery" }
        ]
      });

      console.log(`Successfully assigned active plan "${plan.name}" (Day 3 current) to user "${u.username}" (${u.email})`);
    }

    console.log("Seeding process completed successfully!");
  } catch (err) {
    console.error("Seeding failed:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

main();
