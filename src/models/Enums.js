"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NutritionistApprovalStatus = exports.NutritionistBookingStatus = exports.AppointmentMode = exports.ConsentType = exports.ProgressRecordedBy = exports.MealLogSource = exports.MealLogStatus = exports.NutritionFoodSource = exports.DietaryPreference = exports.MealType = exports.NutritionPlanStatus = exports.NutritionGoal = exports.SplitType = exports.PlanStatus = exports.PlanGoal = exports.AuditAction = exports.ReminderStatus = exports.ReminderKind = exports.NotificationKind = exports.NotificationChannel = exports.WebhookEventStatus = exports.AppointmentSource = exports.WebhookSyncStatus = exports.AppointmentBookingStatus = exports.ExpertType = exports.OnboardingStep = exports.WorkoutSessionStatus = exports.ExerciseSection = exports.ExerciseDifficulty = exports.MuscleGroup = exports.CreditTransactionSource = exports.CreditTransactionType = exports.LeadStatus = exports.TodoStatus = exports.MembershipStatus = exports.BookingStatus = exports.Gender = void 0;
var Gender;
(function (Gender) {
    Gender["Male"] = "Male";
    Gender["Female"] = "Female";
    Gender["Other"] = "Other";
})(Gender || (exports.Gender = Gender = {}));
var BookingStatus;
(function (BookingStatus) {
    BookingStatus[BookingStatus["Booked"] = 0] = "Booked";
    BookingStatus[BookingStatus["Confirmed"] = 1] = "Confirmed";
    BookingStatus[BookingStatus["Cancelled"] = 2] = "Cancelled";
    BookingStatus[BookingStatus["Attended"] = 3] = "Attended";
    BookingStatus[BookingStatus["Unattended"] = 4] = "Unattended";
})(BookingStatus || (exports.BookingStatus = BookingStatus = {}));
var MembershipStatus;
(function (MembershipStatus) {
    MembershipStatus["Active"] = "Active";
    MembershipStatus["Paused"] = "Paused";
    MembershipStatus["Cancelled"] = "Cancelled";
    MembershipStatus["Expired"] = "Expired";
})(MembershipStatus || (exports.MembershipStatus = MembershipStatus = {}));
var TodoStatus;
(function (TodoStatus) {
    TodoStatus[TodoStatus["Todo"] = 0] = "Todo";
    TodoStatus[TodoStatus["Doing"] = 1] = "Doing";
    TodoStatus[TodoStatus["Done"] = 2] = "Done";
})(TodoStatus || (exports.TodoStatus = TodoStatus = {}));
var LeadStatus;
(function (LeadStatus) {
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
(function (CreditTransactionType) {
    CreditTransactionType["Consume"] = "Consume";
    CreditTransactionType["Refund"] = "Refund";
    CreditTransactionType["AdminTopUp"] = "AdminTopUp";
    CreditTransactionType["Void"] = "Void";
})(CreditTransactionType || (exports.CreditTransactionType = CreditTransactionType = {}));
var CreditTransactionSource;
(function (CreditTransactionSource) {
    CreditTransactionSource["Booking"] = "Booking";
    CreditTransactionSource["Appointment"] = "Appointment";
    CreditTransactionSource["Admin"] = "Admin";
})(CreditTransactionSource || (exports.CreditTransactionSource = CreditTransactionSource = {}));
var MuscleGroup;
(function (MuscleGroup) {
    MuscleGroup["Chest"] = "Chest";
    MuscleGroup["Back"] = "Back";
    MuscleGroup["Legs"] = "Legs";
    MuscleGroup["Shoulders"] = "Shoulders";
    MuscleGroup["Arms"] = "Arms";
    MuscleGroup["Core"] = "Core";
    MuscleGroup["FullBody"] = "FullBody";
})(MuscleGroup || (exports.MuscleGroup = MuscleGroup = {}));
var ExerciseDifficulty;
(function (ExerciseDifficulty) {
    ExerciseDifficulty["Beginner"] = "Beginner";
    ExerciseDifficulty["Intermediate"] = "Intermediate";
    ExerciseDifficulty["Advanced"] = "Advanced";
})(ExerciseDifficulty || (exports.ExerciseDifficulty = ExerciseDifficulty = {}));
var ExerciseSection;
(function (ExerciseSection) {
    ExerciseSection["Warmup"] = "warmup";
    ExerciseSection["Workout"] = "workout";
    ExerciseSection["Stretching"] = "stretching";
})(ExerciseSection || (exports.ExerciseSection = ExerciseSection = {}));
var WorkoutSessionStatus;
(function (WorkoutSessionStatus) {
    WorkoutSessionStatus["Active"] = "Active";
    WorkoutSessionStatus["Completed"] = "Completed";
    WorkoutSessionStatus["Abandoned"] = "Abandoned";
})(WorkoutSessionStatus || (exports.WorkoutSessionStatus = WorkoutSessionStatus = {}));
var OnboardingStep;
(function (OnboardingStep) {
    OnboardingStep["HEALTH_MARKERS"] = "HEALTH_MARKERS";
    OnboardingStep["HEALTH_GOALS"] = "HEALTH_GOALS";
    OnboardingStep["CONSENT"] = "CONSENT";
    OnboardingStep["REPORT_UPLOAD"] = "REPORT_UPLOAD";
    OnboardingStep["SPORTS_SCIENTIST_BOOKING"] = "SPORTS_SCIENTIST_BOOKING";
    OnboardingStep["NUTRITIONIST_BOOKING"] = "NUTRITIONIST_BOOKING";
    OnboardingStep["COMPLETED"] = "COMPLETED";
})(OnboardingStep || (exports.OnboardingStep = OnboardingStep = {}));
var ExpertType;
(function (ExpertType) {
    ExpertType["SportsScientist"] = "sports_scientist";
    ExpertType["Nutritionist"] = "nutritionist";
})(ExpertType || (exports.ExpertType = ExpertType = {}));
var AppointmentBookingStatus;
(function (AppointmentBookingStatus) {
    AppointmentBookingStatus["Pending"] = "Pending";
    AppointmentBookingStatus["Confirmed"] = "Confirmed";
    AppointmentBookingStatus["Cancelled"] = "Cancelled";
    AppointmentBookingStatus["Rescheduled"] = "Rescheduled";
    AppointmentBookingStatus["Completed"] = "Completed";
    AppointmentBookingStatus["NoShow"] = "NoShow";
})(AppointmentBookingStatus || (exports.AppointmentBookingStatus = AppointmentBookingStatus = {}));
var WebhookSyncStatus;
(function (WebhookSyncStatus) {
    WebhookSyncStatus["Pending"] = "PENDING";
    WebhookSyncStatus["Synced"] = "SYNCED";
    WebhookSyncStatus["Failed"] = "FAILED";
    WebhookSyncStatus["Stale"] = "STALE";
})(WebhookSyncStatus || (exports.WebhookSyncStatus = WebhookSyncStatus = {}));
var AppointmentSource;
(function (AppointmentSource) {
    AppointmentSource["UserApp"] = "USER_APP";
    AppointmentSource["Admin"] = "ADMIN";
    AppointmentSource["CalDashboard"] = "CAL_DASHBOARD";
})(AppointmentSource || (exports.AppointmentSource = AppointmentSource = {}));
var WebhookEventStatus;
(function (WebhookEventStatus) {
    WebhookEventStatus["Received"] = "RECEIVED";
    WebhookEventStatus["Processing"] = "PROCESSING";
    WebhookEventStatus["Processed"] = "PROCESSED";
    WebhookEventStatus["Failed"] = "FAILED";
    WebhookEventStatus["DLQ"] = "DLQ";
})(WebhookEventStatus || (exports.WebhookEventStatus = WebhookEventStatus = {}));
var NotificationChannel;
(function (NotificationChannel) {
    NotificationChannel["InApp"] = "INAPP";
    NotificationChannel["Push"] = "PUSH";
    NotificationChannel["Socket"] = "SOCKET";
})(NotificationChannel || (exports.NotificationChannel = NotificationChannel = {}));
var NotificationKind;
(function (NotificationKind) {
    NotificationKind["AppointmentBooked"] = "appointment_booked";
    NotificationKind["AppointmentRescheduled"] = "appointment_rescheduled";
    NotificationKind["AppointmentCancelled"] = "appointment_cancelled";
    NotificationKind["AppointmentReminder"] = "appointment_reminder";
    NotificationKind["OnboardingStepUpdated"] = "onboarding_step_updated";
})(NotificationKind || (exports.NotificationKind = NotificationKind = {}));
var ReminderKind;
(function (ReminderKind) {
    ReminderKind["TMinus24H"] = "T_MINUS_24H";
    ReminderKind["TMinus1H"] = "T_MINUS_1H";
    ReminderKind["TMinus15M"] = "T_MINUS_15M";
})(ReminderKind || (exports.ReminderKind = ReminderKind = {}));
var ReminderStatus;
(function (ReminderStatus) {
    ReminderStatus["Scheduled"] = "SCHEDULED";
    ReminderStatus["Fired"] = "FIRED";
    ReminderStatus["Cancelled"] = "CANCELLED";
})(ReminderStatus || (exports.ReminderStatus = ReminderStatus = {}));
var AuditAction;
(function (AuditAction) {
    AuditAction["Booked"] = "BOOKED";
    AuditAction["Rescheduled"] = "RESCHEDULED";
    AuditAction["Cancelled"] = "CANCELLED";
    AuditAction["WebhookSync"] = "WEBHOOK_SYNC";
    AuditAction["StatusChanged"] = "STATUS_CHANGED";
})(AuditAction || (exports.AuditAction = AuditAction = {}));
var PlanGoal;
(function (PlanGoal) {
    PlanGoal["Strength"] = "Strength";
    PlanGoal["Hypertrophy"] = "Hypertrophy";
    PlanGoal["Endurance"] = "Endurance";
    PlanGoal["WeightLoss"] = "WeightLoss";
    PlanGoal["Maintenance"] = "Maintenance";
    PlanGoal["Custom"] = "Custom";
})(PlanGoal || (exports.PlanGoal = PlanGoal = {}));
var PlanStatus;
(function (PlanStatus) {
    PlanStatus["Draft"] = "Draft";
    PlanStatus["Active"] = "Active";
    PlanStatus["Paused"] = "Paused";
    PlanStatus["Completed"] = "Completed";
    PlanStatus["Archived"] = "Archived";
})(PlanStatus || (exports.PlanStatus = PlanStatus = {}));
var SplitType;
(function (SplitType) {
    SplitType["FullBody"] = "FullBody";
    SplitType["UpperLower"] = "UpperLower";
    SplitType["PushPull"] = "PushPull";
    SplitType["PushPullLegs"] = "PushPullLegs";
    SplitType["Custom"] = "Custom";
})(SplitType || (exports.SplitType = SplitType = {}));
var NutritionGoal;
(function (NutritionGoal) {
    NutritionGoal["WeightLoss"] = "WeightLoss";
    NutritionGoal["MuscleGain"] = "MuscleGain";
    NutritionGoal["Maintenance"] = "Maintenance";
    NutritionGoal["Endurance"] = "Endurance";
    NutritionGoal["Medical"] = "Medical";
    NutritionGoal["Custom"] = "Custom";
})(NutritionGoal || (exports.NutritionGoal = NutritionGoal = {}));
var NutritionPlanStatus;
(function (NutritionPlanStatus) {
    NutritionPlanStatus["Draft"] = "Draft";
    NutritionPlanStatus["Scheduled"] = "Scheduled";
    NutritionPlanStatus["Active"] = "Active";
    NutritionPlanStatus["Paused"] = "Paused";
    NutritionPlanStatus["Completed"] = "Completed";
    NutritionPlanStatus["Archived"] = "Archived";
})(NutritionPlanStatus || (exports.NutritionPlanStatus = NutritionPlanStatus = {}));
var MealType;
(function (MealType) {
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
(function (DietaryPreference) {
    DietaryPreference["Veg"] = "Veg";
    DietaryPreference["NonVeg"] = "NonVeg";
    DietaryPreference["Vegan"] = "Vegan";
    DietaryPreference["Eggetarian"] = "Eggetarian";
})(DietaryPreference || (exports.DietaryPreference = DietaryPreference = {}));
var NutritionFoodSource;
(function (NutritionFoodSource) {
    NutritionFoodSource["System"] = "System";
    NutritionFoodSource["Custom"] = "Custom";
})(NutritionFoodSource || (exports.NutritionFoodSource = NutritionFoodSource = {}));
var MealLogStatus;
(function (MealLogStatus) {
    MealLogStatus["Logged"] = "Logged";
    MealLogStatus["Skipped"] = "Skipped";
    MealLogStatus["Partial"] = "Partial";
    MealLogStatus["Pending"] = "Pending";
})(MealLogStatus || (exports.MealLogStatus = MealLogStatus = {}));
var MealLogSource;
(function (MealLogSource) {
    MealLogSource["Manual"] = "Manual";
    MealLogSource["AI"] = "AI";
    MealLogSource["Wearable"] = "Wearable";
    MealLogSource["Scan"] = "Scan";
})(MealLogSource || (exports.MealLogSource = MealLogSource = {}));
var ProgressRecordedBy;
(function (ProgressRecordedBy) {
    ProgressRecordedBy["User"] = "User";
    ProgressRecordedBy["Nutritionist"] = "Nutritionist";
})(ProgressRecordedBy || (exports.ProgressRecordedBy = ProgressRecordedBy = {}));
var ConsentType;
(function (ConsentType) {
    ConsentType["WELLNESS_SERVICES"] = "WELLNESS_SERVICES";
    ConsentType["GYM_FITNESS"] = "GYM_FITNESS";
})(ConsentType || (exports.ConsentType = ConsentType = {}));
var AppointmentMode;
(function (AppointmentMode) {
    AppointmentMode["IN_PERSON"] = "IN_PERSON";
    AppointmentMode["ONLINE"] = "ONLINE";
})(AppointmentMode || (exports.AppointmentMode = AppointmentMode = {}));
var NutritionistBookingStatus;
(function (NutritionistBookingStatus) {
    NutritionistBookingStatus["PENDING"] = "PENDING";
    NutritionistBookingStatus["ACCEPTED"] = "ACCEPTED";
    NutritionistBookingStatus["REJECTED"] = "REJECTED";
    NutritionistBookingStatus["COMPLETED"] = "COMPLETED";
})(NutritionistBookingStatus || (exports.NutritionistBookingStatus = NutritionistBookingStatus = {}));
var NutritionistApprovalStatus;
(function (NutritionistApprovalStatus) {
    NutritionistApprovalStatus["PENDING"] = "PENDING";
    NutritionistApprovalStatus["APPROVED"] = "APPROVED";
    NutritionistApprovalStatus["REJECTED"] = "REJECTED";
})(NutritionistApprovalStatus || (exports.NutritionistApprovalStatus = NutritionistApprovalStatus = {}));
