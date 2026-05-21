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

export enum PlanGoal {
	WeightLoss = "WeightLoss",
	MuscleGain = "MuscleGain",
	Strength = "Strength",
	Endurance = "Endurance",
	Mobility = "Mobility",
	GeneralFitness = "GeneralFitness",
}

export enum SplitType {
	FullBody = "FullBody",
	UpperLower = "UpperLower",
	PushPullLegs = "PushPullLegs",
	BroSplit = "BroSplit",
	Custom = "Custom",
}

export enum PlanStatus {
	Draft = "Draft",
	Published = "Published",
	Archived = "Archived",
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

export enum ConsentType {
	WELLNESS_SERVICES = "WELLNESS_SERVICES",
	GYM_FITNESS = "GYM_FITNESS",
}

export enum AppointmentMode {
	IN_PERSON = "IN_PERSON",
	ONLINE = "ONLINE",
}

export enum NutritionistBookingStatus {
	PENDING = "PENDING",
	ACCEPTED = "ACCEPTED",
	REJECTED = "REJECTED",
	COMPLETED = "COMPLETED",
}

export enum NutritionistApprovalStatus {
	PENDING = "PENDING",
	APPROVED = "APPROVED",
	REJECTED = "REJECTED",
}
