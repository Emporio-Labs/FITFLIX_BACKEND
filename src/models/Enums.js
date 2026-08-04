Object.defineProperty(exports, "__esModule", { value: true });
exports.NutritionistApprovalStatus =
	exports.NutritionistBookingStatus =
	exports.AppointmentMode =
	exports.ConsentType =
	exports.ProgressRecordedBy =
	exports.MealLogSource =
	exports.MealLogStatus =
	exports.NutritionFoodSource =
	exports.DietaryPreference =
	exports.MealType =
	exports.NutritionPlanStatus =
	exports.NutritionGoal =
	exports.SplitType =
	exports.PlanStatus =
	exports.PlanGoal =
	exports.AuditAction =
	exports.ReminderStatus =
	exports.ReminderKind =
	exports.NotificationKind =
	exports.NotificationChannel =
	exports.WebhookEventStatus =
	exports.AppointmentSource =
	exports.WebhookSyncStatus =
	exports.AppointmentBookingStatus =
	exports.ExpertType =
	exports.OnboardingStep =
	exports.WorkoutSessionStatus =
	exports.ExerciseSection =
	exports.ExerciseDifficulty =
	exports.MuscleGroup =
	exports.CreditTransactionSource =
	exports.CreditTransactionType =
	exports.LeadStatus =
	exports.TodoStatus =
	exports.MembershipStatus =
	exports.BookingStatus =
	exports.Gender =
		void 0;
var Gender;
((Gender) => {
	Gender["Male"] = "Male";
	Gender["Female"] = "Female";
	Gender["Other"] = "Other";
})(Gender || (exports.Gender = Gender = {}));
var BookingStatus;
((BookingStatus) => {
	BookingStatus[(BookingStatus["Booked"] = 0)] = "Booked";
	BookingStatus[(BookingStatus["Confirmed"] = 1)] = "Confirmed";
	BookingStatus[(BookingStatus["Cancelled"] = 2)] = "Cancelled";
	BookingStatus[(BookingStatus["Attended"] = 3)] = "Attended";
	BookingStatus[(BookingStatus["Unattended"] = 4)] = "Unattended";
})(BookingStatus || (exports.BookingStatus = BookingStatus = {}));
var MembershipStatus;
((MembershipStatus) => {
	MembershipStatus["Active"] = "Active";
	MembershipStatus["Paused"] = "Paused";
	MembershipStatus["Cancelled"] = "Cancelled";
	MembershipStatus["Expired"] = "Expired";
})(MembershipStatus || (exports.MembershipStatus = MembershipStatus = {}));
var TodoStatus;
((TodoStatus) => {
	TodoStatus[(TodoStatus["Todo"] = 0)] = "Todo";
	TodoStatus[(TodoStatus["Doing"] = 1)] = "Doing";
	TodoStatus[(TodoStatus["Done"] = 2)] = "Done";
})(TodoStatus || (exports.TodoStatus = TodoStatus = {}));
var LeadStatus;
((LeadStatus) => {
	LeadStatus["New"] = "New";
	LeadStatus["Contacted"] = "Contacted";
	LeadStatus["Qualified"] = "Qualified";
	LeadStatus["Warm"] = "Warm";
	LeadStatus["Hot"] = "Hot";
	LeadStatus["Cold"] = "Cold";
	LeadStatus["Converted"] = "Converted";
	LeadStatus["Lost"] = "Lost";
})(LeadStatus || (exports.LeadStatus = LeadStatus = {}));
var CreditTransactionType;
((CreditTransactionType) => {
	CreditTransactionType["Consume"] = "Consume";
	CreditTransactionType["Refund"] = "Refund";
	CreditTransactionType["AdminTopUp"] = "AdminTopUp";
	CreditTransactionType["Void"] = "Void";
})(
	CreditTransactionType ||
		(exports.CreditTransactionType = CreditTransactionType = {}),
);
var CreditTransactionSource;
((CreditTransactionSource) => {
	CreditTransactionSource["Booking"] = "Booking";
	CreditTransactionSource["Appointment"] = "Appointment";
	CreditTransactionSource["Admin"] = "Admin";
})(
	CreditTransactionSource ||
		(exports.CreditTransactionSource = CreditTransactionSource = {}),
);
var MuscleGroup;
((MuscleGroup) => {
	MuscleGroup["Chest"] = "Chest";
	MuscleGroup["Back"] = "Back";
	MuscleGroup["Legs"] = "Legs";
	MuscleGroup["Shoulders"] = "Shoulders";
	MuscleGroup["Arms"] = "Arms";
	MuscleGroup["Core"] = "Core";
	MuscleGroup["FullBody"] = "FullBody";
})(MuscleGroup || (exports.MuscleGroup = MuscleGroup = {}));
var ExerciseDifficulty;
((ExerciseDifficulty) => {
	ExerciseDifficulty["Beginner"] = "Beginner";
	ExerciseDifficulty["Intermediate"] = "Intermediate";
	ExerciseDifficulty["Advanced"] = "Advanced";
})(
	ExerciseDifficulty || (exports.ExerciseDifficulty = ExerciseDifficulty = {}),
);
var ExerciseSection;
((ExerciseSection) => {
	ExerciseSection["Warmup"] = "warmup";
	ExerciseSection["Workout"] = "workout";
	ExerciseSection["Stretching"] = "stretching";
})(ExerciseSection || (exports.ExerciseSection = ExerciseSection = {}));
var WorkoutSessionStatus;
((WorkoutSessionStatus) => {
	WorkoutSessionStatus["Active"] = "Active";
	WorkoutSessionStatus["Completed"] = "Completed";
	WorkoutSessionStatus["Abandoned"] = "Abandoned";
})(
	WorkoutSessionStatus ||
		(exports.WorkoutSessionStatus = WorkoutSessionStatus = {}),
);
var OnboardingStep;
((OnboardingStep) => {
	OnboardingStep["HEALTH_MARKERS"] = "HEALTH_MARKERS";
	OnboardingStep["HEALTH_GOALS"] = "HEALTH_GOALS";
	OnboardingStep["CONSENT"] = "CONSENT";
	OnboardingStep["REPORT_UPLOAD"] = "REPORT_UPLOAD";
	OnboardingStep["NUTRITIONIST_BOOKING"] = "NUTRITIONIST_BOOKING";
	OnboardingStep["COMPLETED"] = "COMPLETED";
})(OnboardingStep || (exports.OnboardingStep = OnboardingStep = {}));
var ExpertType;
((ExpertType) => {
	ExpertType["Nutritionist"] = "nutritionist";
})(ExpertType || (exports.ExpertType = ExpertType = {}));
var AppointmentBookingStatus;
((AppointmentBookingStatus) => {
	AppointmentBookingStatus["Pending"] = "Pending";
	AppointmentBookingStatus["Confirmed"] = "Confirmed";
	AppointmentBookingStatus["Cancelled"] = "Cancelled";
	AppointmentBookingStatus["Rescheduled"] = "Rescheduled";
	AppointmentBookingStatus["Completed"] = "Completed";
	AppointmentBookingStatus["NoShow"] = "NoShow";
})(
	AppointmentBookingStatus ||
		(exports.AppointmentBookingStatus = AppointmentBookingStatus = {}),
);
var WebhookSyncStatus;
((WebhookSyncStatus) => {
	WebhookSyncStatus["Pending"] = "PENDING";
	WebhookSyncStatus["Synced"] = "SYNCED";
	WebhookSyncStatus["Failed"] = "FAILED";
	WebhookSyncStatus["Stale"] = "STALE";
})(WebhookSyncStatus || (exports.WebhookSyncStatus = WebhookSyncStatus = {}));
var AppointmentSource;
((AppointmentSource) => {
	AppointmentSource["UserApp"] = "USER_APP";
	AppointmentSource["Admin"] = "ADMIN";
	AppointmentSource["CalDashboard"] = "CAL_DASHBOARD";
})(AppointmentSource || (exports.AppointmentSource = AppointmentSource = {}));
var WebhookEventStatus;
((WebhookEventStatus) => {
	WebhookEventStatus["Received"] = "RECEIVED";
	WebhookEventStatus["Processing"] = "PROCESSING";
	WebhookEventStatus["Processed"] = "PROCESSED";
	WebhookEventStatus["Failed"] = "FAILED";
	WebhookEventStatus["DLQ"] = "DLQ";
})(
	WebhookEventStatus || (exports.WebhookEventStatus = WebhookEventStatus = {}),
);
var NotificationChannel;
((NotificationChannel) => {
	NotificationChannel["InApp"] = "INAPP";
	NotificationChannel["Push"] = "PUSH";
	NotificationChannel["Socket"] = "SOCKET";
})(
	NotificationChannel ||
		(exports.NotificationChannel = NotificationChannel = {}),
);
var NotificationKind;
((NotificationKind) => {
	NotificationKind["AppointmentBooked"] = "appointment_booked";
	NotificationKind["AppointmentRescheduled"] = "appointment_rescheduled";
	NotificationKind["AppointmentCancelled"] = "appointment_cancelled";
	NotificationKind["AppointmentReminder"] = "appointment_reminder";
	NotificationKind["OnboardingStepUpdated"] = "onboarding_step_updated";
	NotificationKind["MembershipExpiryReminder"] = "membership_expiry_reminder";
})(NotificationKind || (exports.NotificationKind = NotificationKind = {}));
var ReminderKind;
((ReminderKind) => {
	ReminderKind["TMinus24H"] = "T_MINUS_24H";
	ReminderKind["TMinus1H"] = "T_MINUS_1H";
	ReminderKind["TMinus15M"] = "T_MINUS_15M";
})(ReminderKind || (exports.ReminderKind = ReminderKind = {}));
var ReminderStatus;
((ReminderStatus) => {
	ReminderStatus["Scheduled"] = "SCHEDULED";
	ReminderStatus["Fired"] = "FIRED";
	ReminderStatus["Cancelled"] = "CANCELLED";
})(ReminderStatus || (exports.ReminderStatus = ReminderStatus = {}));
var AuditAction;
((AuditAction) => {
	AuditAction["Booked"] = "BOOKED";
	AuditAction["Rescheduled"] = "RESCHEDULED";
	AuditAction["Cancelled"] = "CANCELLED";
	AuditAction["WebhookSync"] = "WEBHOOK_SYNC";
	AuditAction["StatusChanged"] = "STATUS_CHANGED";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
var PlanGoal;
((PlanGoal) => {
	PlanGoal["Strength"] = "Strength";
	PlanGoal["Hypertrophy"] = "Hypertrophy";
	PlanGoal["Endurance"] = "Endurance";
	PlanGoal["WeightLoss"] = "WeightLoss";
	PlanGoal["Maintenance"] = "Maintenance";
	PlanGoal["Custom"] = "Custom";
})(PlanGoal || (exports.PlanGoal = PlanGoal = {}));
var PlanStatus;
((PlanStatus) => {
	PlanStatus["Draft"] = "Draft";
	PlanStatus["Active"] = "Active";
	PlanStatus["Paused"] = "Paused";
	PlanStatus["Completed"] = "Completed";
	PlanStatus["Archived"] = "Archived";
})(PlanStatus || (exports.PlanStatus = PlanStatus = {}));
var SplitType;
((SplitType) => {
	SplitType["FullBody"] = "FullBody";
	SplitType["UpperLower"] = "UpperLower";
	SplitType["PushPull"] = "PushPull";
	SplitType["PushPullLegs"] = "PushPullLegs";
	SplitType["Custom"] = "Custom";
})(SplitType || (exports.SplitType = SplitType = {}));
var NutritionGoal;
((NutritionGoal) => {
	NutritionGoal["WeightLoss"] = "WeightLoss";
	NutritionGoal["MuscleGain"] = "MuscleGain";
	NutritionGoal["Maintenance"] = "Maintenance";
	NutritionGoal["Endurance"] = "Endurance";
	NutritionGoal["Medical"] = "Medical";
	NutritionGoal["Custom"] = "Custom";
})(NutritionGoal || (exports.NutritionGoal = NutritionGoal = {}));
var NutritionPlanStatus;
((NutritionPlanStatus) => {
	NutritionPlanStatus["Draft"] = "Draft";
	NutritionPlanStatus["Scheduled"] = "Scheduled";
	NutritionPlanStatus["Active"] = "Active";
	NutritionPlanStatus["Paused"] = "Paused";
	NutritionPlanStatus["Completed"] = "Completed";
	NutritionPlanStatus["Archived"] = "Archived";
})(
	NutritionPlanStatus ||
		(exports.NutritionPlanStatus = NutritionPlanStatus = {}),
);
var MealType;
((MealType) => {
	MealType["Breakfast"] = "Breakfast";
	MealType["Lunch"] = "Lunch";
	MealType["Dinner"] = "Dinner";
	MealType["Snack"] = "Snack";
	MealType["PreWorkout"] = "PreWorkout";
	MealType["PostWorkout"] = "PostWorkout";
	MealType["EarlyMorning"] = "EarlyMorning";
	MealType["DuringWorkout"] = "DuringWorkout";
	MealType["EveningSnack"] = "EveningSnack";
	MealType["Bedtime"] = "Bedtime";
})(MealType || (exports.MealType = MealType = {}));
var DietaryPreference;
((DietaryPreference) => {
	DietaryPreference["Veg"] = "Veg";
	DietaryPreference["NonVeg"] = "NonVeg";
	DietaryPreference["Vegan"] = "Vegan";
	DietaryPreference["Eggetarian"] = "Eggetarian";
})(DietaryPreference || (exports.DietaryPreference = DietaryPreference = {}));
var NutritionFoodSource;
((NutritionFoodSource) => {
	NutritionFoodSource["System"] = "System";
	NutritionFoodSource["Custom"] = "Custom";
})(
	NutritionFoodSource ||
		(exports.NutritionFoodSource = NutritionFoodSource = {}),
);
var MealLogStatus;
((MealLogStatus) => {
	MealLogStatus["Logged"] = "Logged";
	MealLogStatus["Skipped"] = "Skipped";
	MealLogStatus["Partial"] = "Partial";
	MealLogStatus["Pending"] = "Pending";
})(MealLogStatus || (exports.MealLogStatus = MealLogStatus = {}));
var MealLogSource;
((MealLogSource) => {
	MealLogSource["Manual"] = "Manual";
	MealLogSource["AI"] = "AI";
	MealLogSource["Wearable"] = "Wearable";
	MealLogSource["Scan"] = "Scan";
})(MealLogSource || (exports.MealLogSource = MealLogSource = {}));
var ProgressRecordedBy;
((ProgressRecordedBy) => {
	ProgressRecordedBy["User"] = "User";
	ProgressRecordedBy["Nutritionist"] = "Nutritionist";
})(
	ProgressRecordedBy || (exports.ProgressRecordedBy = ProgressRecordedBy = {}),
);
var ConsentType;
((ConsentType) => {
	ConsentType["WELLNESS_SERVICES"] = "WELLNESS_SERVICES";
	ConsentType["GYM_FITNESS"] = "GYM_FITNESS";
})(ConsentType || (exports.ConsentType = ConsentType = {}));
var AppointmentMode;
((AppointmentMode) => {
	AppointmentMode["IN_PERSON"] = "IN_PERSON";
	AppointmentMode["ONLINE"] = "ONLINE";
})(AppointmentMode || (exports.AppointmentMode = AppointmentMode = {}));
var MeetingStatus;
((MeetingStatus) => {
	MeetingStatus["SCHEDULED"] = "SCHEDULED";
	MeetingStatus["IN_PROGRESS"] = "IN_PROGRESS";
	MeetingStatus["COMPLETED"] = "COMPLETED";
})(MeetingStatus || (exports.MeetingStatus = MeetingStatus = {}));
var NutritionistBookingStatus;
((NutritionistBookingStatus) => {
	NutritionistBookingStatus["PENDING"] = "PENDING";
	NutritionistBookingStatus["ACCEPTED"] = "ACCEPTED";
	NutritionistBookingStatus["REJECTED"] = "REJECTED";
	NutritionistBookingStatus["COMPLETED"] = "COMPLETED";
})(
	NutritionistBookingStatus ||
		(exports.NutritionistBookingStatus = NutritionistBookingStatus = {}),
);
var NutritionistApprovalStatus;
((NutritionistApprovalStatus) => {
	NutritionistApprovalStatus["PENDING"] = "PENDING";
	NutritionistApprovalStatus["APPROVED"] = "APPROVED";
	NutritionistApprovalStatus["REJECTED"] = "REJECTED";
})(
	NutritionistApprovalStatus ||
		(exports.NutritionistApprovalStatus = NutritionistApprovalStatus = {}),
);
