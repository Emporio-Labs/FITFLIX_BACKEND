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

export enum PlanStatus {
	Draft = "Draft",
	Active = "Active",
	Archived = "Archived",
}

export enum SplitType {
	FullBody = "FullBody",
	UpperLower = "UpperLower",
	PushPullLegs = "PushPullLegs",
	BroSplit = "BroSplit",
	Custom = "Custom",
}

export enum PlanGoal {
	MuscleGain = "MuscleGain",
	FatLoss = "FatLoss",
	Strength = "Strength",
	Endurance = "Endurance",
	Flexibility = "Flexibility",
	GeneralFitness = "GeneralFitness",
}
