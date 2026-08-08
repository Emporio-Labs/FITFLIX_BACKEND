export enum Gender {
	Male = "Male",
	Female = "Female",
	Other = "Other",
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
	FullBody = "FullBody",
}

export enum ExerciseDifficulty {
	Beginner = "Beginner",
	Intermediate = "Intermediate",
	Advanced = "Advanced",
}

export enum ExerciseSection {
	Warmup = "warmup",
	Workout = "workout",
	Stretching = "stretching",
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
	NUTRITIONIST_BOOKING = "NUTRITIONIST_BOOKING",
	COMPLETED = "COMPLETED",
}

export enum ExpertType {
	Nutritionist = "nutritionist",
}

export enum AppointmentBookingStatus {
	Pending = "Pending",
	Confirmed = "Confirmed",
	Cancelled = "Cancelled",
	Rescheduled = "Rescheduled",
	Completed = "Completed",
	NoShow = "NoShow",
}

export enum WebhookSyncStatus {
	Pending = "PENDING",
	Synced = "SYNCED",
	Failed = "FAILED",
	Stale = "STALE",
}

export enum AppointmentSource {
	UserApp = "USER_APP",
	Admin = "ADMIN",
	CalDashboard = "CAL_DASHBOARD",
}

export enum WebhookEventStatus {
	Received = "RECEIVED",
	Processing = "PROCESSING",
	Processed = "PROCESSED",
	Failed = "FAILED",
	DLQ = "DLQ",
}

export enum NotificationChannel {
	InApp = "INAPP",
	Push = "PUSH",
	Socket = "SOCKET",
}

export enum NotificationKind {
	AppointmentBooked = "appointment_booked",
	AppointmentRescheduled = "appointment_rescheduled",
	AppointmentCancelled = "appointment_cancelled",
	AppointmentReminder = "appointment_reminder",
	OnboardingStepUpdated = "onboarding_step_updated",
	MembershipExpiryReminder = "membership_expiry_reminder",
}

export enum ReminderKind {
	TMinus24H = "T_MINUS_24H",
	TMinus1H = "T_MINUS_1H",
	TMinus15M = "T_MINUS_15M",
}

export enum ReminderStatus {
	Scheduled = "SCHEDULED",
	Fired = "FIRED",
	Cancelled = "CANCELLED",
}

export enum AuditAction {
	Booked = "BOOKED",
	Rescheduled = "RESCHEDULED",
	Cancelled = "CANCELLED",
	WebhookSync = "WEBHOOK_SYNC",
	StatusChanged = "STATUS_CHANGED",
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

export enum IngredientUnit {
	Gram = "g",
	Milliliter = "ml",
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

export enum ImportRowType {
	CategoryHeader = "CategoryHeader",
	ColumnHeader = "ColumnHeader",
	Empty = "Empty",
	Total = "Total",
	Recipe = "Recipe",
	Ingredient = "Ingredient",
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

export enum ConsentType {
	WELLNESS_SERVICES = "WELLNESS_SERVICES",
	GYM_FITNESS = "GYM_FITNESS",
}

export enum AppointmentMode {
	IN_PERSON = "IN_PERSON",
	ONLINE = "ONLINE",
}

export enum MeetingStatus {
	SCHEDULED = "SCHEDULED",
	IN_PROGRESS = "IN_PROGRESS",
	COMPLETED = "COMPLETED",
}

export enum NutritionistBookingStatus {
	PENDING = "PENDING",
	ACCEPTED = "ACCEPTED",
	REJECTED = "REJECTED",
	COMPLETED = "COMPLETED",
	EXPIRED = "EXPIRED",
	RESCHEDULE_REQUIRED = "RESCHEDULE_REQUIRED",
}

export enum NutritionistApprovalStatus {
	PENDING = "PENDING",
	APPROVED = "APPROVED",
	REJECTED = "REJECTED",
}

export enum InvoicePaymentStatus {
	DRAFT = "DRAFT",
	PENDING = "PENDING",
	PAID = "PAID",
	FAILED = "FAILED",
	CANCELLED = "CANCELLED",
	REFUNDED = "REFUNDED",
}

export enum InvoicePaymentMethod {
	CASH = "CASH",
	UPI = "UPI",
	CARD = "CARD",
	BANK_TRANSFER = "BANK_TRANSFER",
	NONE = "NONE",
}

export enum DeletionRequestStatus {
	Pending = "Pending",
	Processed = "Processed",
	Cancelled = "Cancelled",
}
