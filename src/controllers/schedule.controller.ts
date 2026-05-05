import type { RequestHandler } from "express";
import mongoose from "mongoose";
import Schedule from "../models/Schedule";
import User from "../models/User";
import {
	createScheduleBodySchema,
	rescheduleBodySchema,
	updateScheduleBodySchema,
} from "../validators/schedule.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
	if (
		typeof idParam !== "string" ||
		!mongoose.Types.ObjectId.isValid(idParam)
	) {
		return null;
	}

	return idParam;
};

const getRequiredAuthenticatedUser = (req: Parameters<RequestHandler>[0]) => {
	if (!req.user) {
		return null;
	}

	return req.user;
};

const isWithinSevenDays = (date: Date): boolean => {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const target = new Date(date);
	target.setHours(0, 0, 0, 0);

	const timeDiff = target.getTime() - today.getTime();
	const daysDiff = timeDiff / (1000 * 3600 * 24);

	return daysDiff >= 0 && daysDiff <= 7;
};

// Get current user's own schedule
export const getMySchedule: RequestHandler = async (req, res, next) => {
	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	try {
		const schedule = await Schedule.findOne({ user: requester.id })
			.populate("user", "username email")
			.populate("todos");

		if (!schedule) {
			res.status(404).json({ message: "Schedule not found" });
			return;
		}

		res.status(200).json({ message: "Schedule retrieved", schedule });
	} catch (error) {
		next(error);
	}
};

// Create a new schedule for a user
export const createSchedule: RequestHandler = async (req, res, next) => {
	const parsedBody = createScheduleBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid schedule payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const { userId, scheduledDate, status, todoIds } = parsedBody.data;

	// Users can only create their own schedule
	// Doctors, Trainers, and Admins can create for any user
	if (requester.role === "user" && userId !== requester.id) {
		res.status(403).json({
			message: "Users can only create schedules for themselves",
		});
		return;
	}

	if (!mongoose.Types.ObjectId.isValid(userId)) {
		res.status(400).json({ message: "Invalid userId" });
		return;
	}

	// Validate all todo IDs if provided
	if (
		todoIds &&
		todoIds.length > 0 &&
		!todoIds.every((id) => mongoose.Types.ObjectId.isValid(id))
	) {
		res.status(400).json({ message: "Invalid todo IDs" });
		return;
	}

	try {
		// Check if user exists
		const userExists = await User.findById(userId);
		if (!userExists) {
			res.status(404).json({ message: "User not found" });
			return;
		}

		const schedule = await Schedule.create({
			user: userId,
			scheduledDate,
			status,
			todos: todoIds || [],
		});

		const populatedSchedule = await Schedule.findById(schedule._id)
			.populate("user", "username email")
			.populate("todos");

		res.status(201).json({
			message: "Schedule created successfully",
			schedule: populatedSchedule,
		});
	} catch (error) {
		next(error);
	}
};

// Get a specific user's schedule
export const getScheduleByUserId: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);

	if (!userId) {
		res.status(400).json({ message: "Invalid userId format" });
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	// Users can only view their own schedule
	// Doctors, Trainers, and Admins can view any schedule
	if (requester.role === "user" && userId !== requester.id) {
		res.status(403).json({
			message: "Users can only view their own schedule",
		});
		return;
	}

	try {
		const schedule = await Schedule.findOne({ user: userId })
			.populate("user", "username email")
			.populate("todos");

		if (!schedule) {
			res.status(404).json({ message: "Schedule not found" });
			return;
		}

		res.status(200).json({
			message: "Schedule retrieved successfully",
			schedule,
		});
	} catch (error) {
		next(error);
	}
};

// Update a user's schedule (status, todos, or date)
export const updateSchedule: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);

	if (!userId) {
		res.status(400).json({ message: "Invalid userId format" });
		return;
	}

	const parsedBody = updateScheduleBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid schedule payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	// Users can only edit their own schedule
	// Doctors, Trainers, and Admins can edit any schedule
	if (requester.role === "user" && userId !== requester.id) {
		res.status(403).json({
			message: "Users can only edit their own schedule",
		});
		return;
	}

	const { scheduledDate, status, todoIds } = parsedBody.data;

	// Validate all todo IDs if provided
	if (
		todoIds &&
		todoIds.length > 0 &&
		!todoIds.every((id) => mongoose.Types.ObjectId.isValid(id))
	) {
		res.status(400).json({ message: "Invalid todo IDs" });
		return;
	}

	try {
		const schedule = await Schedule.findOne({ user: userId });

		if (!schedule) {
			res.status(404).json({ message: "Schedule not found" });
			return;
		}

		if (scheduledDate !== undefined) {
			schedule.scheduledDate = scheduledDate;
		}

		if (status !== undefined) {
			schedule.status = status;
		}

		if (todoIds !== undefined) {
			schedule.todos = todoIds.map(
				(todoId) => new mongoose.Types.ObjectId(todoId),
			);
		}

		await schedule.save();

		const updatedSchedule = await Schedule.findOne({ user: userId })
			.populate("user", "username email")
			.populate("todos");

		res.status(200).json({
			message: "Schedule updated successfully",
			schedule: updatedSchedule,
		});
	} catch (error) {
		next(error);
	}
};

// Reschedule a user's schedule (only within next 7 days)
export const rescheduleSchedule: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);

	if (!userId) {
		res.status(400).json({ message: "Invalid userId format" });
		return;
	}

	const parsedBody = rescheduleBodySchema.safeParse(req.body);

	if (!parsedBody.success) {
		res.status(400).json({
			message: "Invalid reschedule payload",
			errors: parsedBody.error.issues,
		});
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	// Users can only reschedule their own schedule
	// Doctors, Trainers, and Admins can reschedule any schedule
	if (requester.role === "user" && userId !== requester.id) {
		res.status(403).json({
			message: "Users can only reschedule their own schedule",
		});
		return;
	}

	const { newScheduledDate } = parsedBody.data;

	// Validate date is within next 7 days
	if (!isWithinSevenDays(newScheduledDate)) {
		res.status(400).json({
			message: "Schedule can only be rescheduled within the next 7 days",
		});
		return;
	}

	try {
		const schedule = await Schedule.findOne({ user: userId });

		if (!schedule) {
			res.status(404).json({ message: "Schedule not found" });
			return;
		}

		schedule.scheduledDate = newScheduledDate;
		await schedule.save();

		const updatedSchedule = await Schedule.findOne({ user: userId })
			.populate("user", "username email")
			.populate("todos");

		res.status(200).json({
			message: "Schedule rescheduled successfully",
			schedule: updatedSchedule,
		});
	} catch (error) {
		next(error);
	}
};

// Delete a user's schedule (admin only)
export const deleteSchedule: RequestHandler = async (req, res, next) => {
	const userId = getIdParam(req.params.userId);

	if (!userId) {
		res.status(400).json({ message: "Invalid userId format" });
		return;
	}

	const requester = getRequiredAuthenticatedUser(req);

	if (!requester) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	// Only admins can delete schedules
	if (requester.role !== "admin") {
		res.status(403).json({
			message: "Only admins can delete schedules",
		});
		return;
	}

	try {
		const schedule = await Schedule.findOneAndDelete({ user: userId });

		if (!schedule) {
			res.status(404).json({ message: "Schedule not found" });
			return;
		}

		res.status(200).json({ message: "Schedule deleted successfully" });
	} catch (error) {
		next(error);
	}
};
