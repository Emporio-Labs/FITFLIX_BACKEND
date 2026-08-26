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
	PersonalTraining = "PersonalTraining",
	Therapy = "Therapy",
	// Written by the expiry job when unused value lapses. Distinct from Admin
	// so lapsed value is separable from staff adjustments in reporting.
	Expiry = "Expiry",
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
	// Legacy app-owned setup steps. Kept for compatibility with the existing
	// member app wizard and its currentStep pointer.
	HEALTH_MARKERS = "HEALTH_MARKERS",
	HEALTH_GOALS = "HEALTH_GOALS",
	CONSENT = "CONSENT",
	REPORT_UPLOAD = "REPORT_UPLOAD",
	NUTRITIONIST_BOOKING = "NUTRITIONIST_BOOKING",

	// Shared membership onboarding steps. These are independent flags and are
	// intentionally not part of the app wizard's sequential currentStep path.
	ACTIVE_X_TEST = "ACTIVE_X_TEST",
	DNA_SAMPLE = "DNA_SAMPLE",
	VALD_TEST = "VALD_TEST",
	NUTRITION_APPOINTMENT = "NUTRITION_APPOINTMENT",
	SPORT_SCIENTIST_APPOINTMENT = "SPORT_SCIENTIST_APPOINTMENT",
	PLAN_TRAINER_ASSIGNMENT = "PLAN_TRAINER_ASSIGNMENT",
	COMPLETED = "COMPLETED",
}

export enum ExpertType {
	Nutritionist = "nutritionist",
	Trainer = "trainer",
	Doctor = "doctor",
	SportsScientist = "sports_scientist",
}

export enum ServiceCategory {
	EXPERT_SESSION = "EXPERT_SESSION",
	GROUP_CLASS = "GROUP_CLASS",
	FACILITY_RESOURCE = "FACILITY_RESOURCE",
	RETAIL_ORDER = "RETAIL_ORDER",
}

export enum ServiceSubtype {
	TRAINER = "TRAINER",
	NUTRITIONIST = "NUTRITIONIST",
	DOCTOR = "DOCTOR",
	SPORTS_SCIENTIST = "SPORTS_SCIENTIST",
	CLASS = "CLASS",
	STREAM = "STREAM",
	CRYO = "CRYO",
	SAUNA = "SAUNA",
	ICE_BATH = "ICE_BATH",
	SOMATICS = "SOMATICS",
	RETAIL = "RETAIL",
}

export enum UnifiedBookingStatus {
	PENDING = "PENDING",
	CONFIRMED = "CONFIRMED",
	CANCELLED = "CANCELLED",
	COMPLETED = "COMPLETED",
	HOST_NO_SHOW = "HOST_NO_SHOW",
	EXPIRED = "EXPIRED",
	RESCHEDULE_REQUIRED = "RESCHEDULE_REQUIRED",
}

export enum TrainerChangeRequestStatus {
	PENDING = "PENDING",
	APPROVED = "APPROVED",
	REJECTED = "REJECTED",
}

export enum AppointmentBookingStatus {
	Pending = "Pending",
	Confirmed = "Confirmed",
	/** Declined by staff from the front-desk queue. Deliberately distinct from
	 *  `Cancelled`, which is the member withdrawing — the front desk needs to
	 *  tell the two apart, exactly as NutritionistBookingStatus already does. */
	Rejected = "Rejected",
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
	// Community engagement. Kept as distinct kinds rather than one
	// "community" bucket so the client can badge and route each one.
	CommunityPostLiked = "community_post_liked",
	CommunityPostCommented = "community_post_commented",
	CommunityCommentReplied = "community_comment_replied",
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
	MuscleGain = "MuscleGain",
	Mobility = "Mobility",
	GeneralFitness = "GeneralFitness",
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
	BroSplit = "BroSplit",
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
	External = "External",
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
	OFFLINE = "OFFLINE",
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
	/** Withdrawn by the member. Distinct from REJECTED, which is a staff
	 *  decision — the front desk needs to tell the two apart. */
	CANCELLED = "CANCELLED",
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
	RAZORPAY = "RAZORPAY",
	POS_CARD = "POS_CARD",
	ONLINE = "ONLINE",
	NONE = "NONE",
}

export enum DeletionRequestStatus {
	Pending = "Pending",
	Processed = "Processed",
	Cancelled = "Cancelled",
}

// ────────────────────────────────────────────────────────────────────────────
// Community module
// ────────────────────────────────────────────────────────────────────────────

/** Account status gate. Insider/outsider is DERIVED from membership, not stored. */
export enum UserStatus {
	Active = "active",
	Suspended = "suspended",
	Banned = "banned",
}

/**
 * Effective community role, resolved per request (never stored on the user and
 * never placed in the JWT). Precedence: admin > trainer > insider > outsider.
 * Insider = a User with an unexpired active Membership; outsider = without one.
 */
export enum CommunityRole {
	Outsider = "outsider",
	Insider = "insider",
	Trainer = "trainer",
	Admin = "admin",
}

export enum PostVisibility {
	Public = "public",
	MembersOnly = "members_only",
}

export enum PostStatus {
	Draft = "draft",
	Scheduled = "scheduled",
	Published = "published",
	Archived = "archived",
}

export enum PostMediaKind {
	Image = "image",
	Video = "video",
	Audio = "audio",
	File = "file",
}

export enum LikeTargetType {
	Post = "post",
	Comment = "comment",
}

export enum ShareChannel {
	Copy = "copy",
	WhatsApp = "whatsapp",
	Instagram = "instagram",
	Facebook = "facebook",
	Twitter = "twitter",
	Other = "other",
}

export enum ReportTargetType {
	Post = "post",
	Comment = "comment",
	User = "user",
}

export enum ReportStatus {
	Pending = "pending",
	Reviewing = "reviewing",
	Resolved = "resolved",
	Dismissed = "dismissed",
}

export enum ModerationTargetType {
	Post = "post",
	Comment = "comment",
	User = "user",
}

export enum ModerationActionType {
	Edit = "edit",
	Delete = "delete",
	Restore = "restore",
	Pin = "pin",
	Unpin = "unpin",
	CreateOfficial = "create_official",
	DeleteComment = "delete_comment",
	Suspend = "suspend",
	Unsuspend = "unsuspend",
	Ban = "ban",
	Unban = "unban",
	RoleAssign = "role_assign",
	RoleRevoke = "role_revoke",
	Warn = "warn",
	ResolveReport = "resolve_report",
	DismissReport = "dismiss_report",
	// Retained from Day 1.
	Hide = "hide",
	Unhide = "unhide",
}

export enum BlockTargetType {
	User = "user",
}
