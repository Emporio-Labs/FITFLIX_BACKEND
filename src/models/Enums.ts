export enum Gender {
	Male,
	Female,
	Others,
}

export enum BookingStatus {
	Booked,
	Confirmed,
	Cancelled,
	Attended,
	Unattended,
}

export enum MembershipStatus {
	Active = "Active",
	Paused = "Paused",
	Cancelled = "Cancelled",
	Expired = "Expired",
}

export enum TodoStatus {
	Todo,
	Doing,
	Done,
}

export enum LeadStatus {
	New = "New",
	Contacted = "Contacted",
	Qualified = "Qualified",
	Warm = "Warm",
	Hot = "Hot",
	Cold = "Cold",
	Converted = "Converted",
	Lost = "Lost",
}

export enum CreditTransactionType {
	Consume = "Consume",
	Refund = "Refund",
	AdminTopUp = "AdminTopUp",
	Void = "Void",
}

export enum CreditTransactionSource {
	Booking = "Booking",
	Appointment = "Appointment",
	Admin = "Admin",
}

export enum MuscleGroup {
	Chest = "Chest",
	Back = "Back",
	Legs = "Legs",
	Shoulders = "Shoulders",
	Arms = "Arms",
	Core = "Core",
}

export enum ExerciseDifficulty {
	Beginner = "Beginner",
	Intermediate = "Intermediate",
	Advanced = "Advanced",
}

export enum WorkoutSessionStatus {
	Active = "Active",
	Completed = "Completed",
	Abandoned = "Abandoned",
}

export enum OnboardingStep {
	HEALTH_MARKERS = "HEALTH_MARKERS",
	HEALTH_GOALS = "HEALTH_GOALS",
	CONSENT = "CONSENT",
	REPORT_UPLOAD = "REPORT_UPLOAD",
	SPORTS_SCIENTIST_BOOKING = "SPORTS_SCIENTIST_BOOKING",
	NUTRITIONIST_BOOKING = "NUTRITIONIST_BOOKING",
	COMPLETED = "COMPLETED",
}

export enum ExpertType {
	SportsScientist = "sports_scientist",
	Nutritionist = "nutritionist",
}

export enum AppointmentBookingStatus {
	Pending = "Pending",
	Confirmed = "Confirmed",
	Cancelled = "Cancelled",
}

export enum PlanGoal {
	Strength = "Strength",
	Hypertrophy = "Hypertrophy",
	Endurance = "Endurance",
	WeightLoss = "WeightLoss",
	Maintenance = "Maintenance",
	Custom = "Custom",
}

export enum PlanStatus {
	Draft = "Draft",
	Active = "Active",
	Paused = "Paused",
	Completed = "Completed",
	Archived = "Archived",
}

export enum SplitType {
	FullBody = "FullBody",
	UpperLower = "UpperLower",
	PushPull = "PushPull",
	PushPullLegs = "PushPullLegs",
	Custom = "Custom",
}

export enum NutritionGoal {
	WeightLoss = "WeightLoss",
	MuscleGain = "MuscleGain",
	Maintenance = "Maintenance",
	Endurance = "Endurance",
	Medical = "Medical",
	Custom = "Custom",
}

export enum NutritionPlanStatus {
	Draft = "Draft",
	Scheduled = "Scheduled",
	Active = "Active",
	Paused = "Paused",
	Completed = "Completed",
	Archived = "Archived",
}

export enum MealType {
	Breakfast = "Breakfast",
	Lunch = "Lunch",
	Dinner = "Dinner",
	Snack = "Snack",
	PreWorkout = "PreWorkout",
	PostWorkout = "PostWorkout",
	EarlyMorning = "EarlyMorning",
	DuringWorkout = "DuringWorkout",
	EveningSnack = "EveningSnack",
	Bedtime = "Bedtime",
}

export enum DietaryPreference {
	Veg = "Veg",
	NonVeg = "NonVeg",
	Vegan = "Vegan",
	Eggetarian = "Eggetarian",
}

export enum NutritionFoodSource {
	System = "System",
	Custom = "Custom",
}

export enum MealLogStatus {
	Logged = "Logged",
	Skipped = "Skipped",
	Partial = "Partial",
	Pending = "Pending",
}

export enum MealLogSource {
	Manual = "Manual",
	AI = "AI",
	Wearable = "Wearable",
	Scan = "Scan",
}

export enum ProgressRecordedBy {
	User = "User",
	Nutritionist = "Nutritionist",
}
