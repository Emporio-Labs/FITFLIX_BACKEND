import type { RequestHandler } from "express";
import mongoose from "mongoose";
import MembershipPlan from "../models/MembershipPlan";
import {
    createMembershipPlanSchema,
    updateMembershipPlanSchema,
} from "../validators/membershipPlan.validator";

const getIdParam = (idParam: string | string[] | undefined): string | null => {
    if (typeof idParam !== "string" || !mongoose.Types.ObjectId.isValid(idParam)) {
        return null;
    }

    return idParam;
};

export const createMembershipPlan: RequestHandler = async (req, res, next) => {
    const requestId = `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const parsed = createMembershipPlanSchema.safeParse(req.body);
    if (!parsed.success) {
        console.warn("createMembershipPlan validation failed", { requestId, errors: parsed.error.issues });
        res.status(400).json({
            message: "Invalid payload",
            code: "INVALID_PAYLOAD",
            requestId,
            details: parsed.error.issues,
        });
        return;
    }

    try {
        console.info("createMembershipPlan request", { requestId, body: { name: parsed.data.name, gymId: parsed.data.gymId } });
        const plan = await MembershipPlan.create(parsed.data);
        res.status(201).json({ message: "Membership plan created", plan, requestId });
    } catch (error: any) {
        if (error?.name === "MongoServerError" && error?.code === 11000) {
            console.warn("createMembershipPlan duplicate key", { requestId, error: error.message });
            res.status(409).json({
                message: "Membership plan already exists",
                code: "DUPLICATE_RESOURCE",
                requestId,
                details: error.keyValue ?? null,
            });
            return;
        }

        console.error("createMembershipPlan error", { requestId, error: String(error) });
        res.status(500).json({ message: "Failed to create membership plan", code: "INTERNAL_ERROR", requestId });
    }
};

export const getAllMembershipPlans: RequestHandler = async (_req, res, next) => {
    try {
        const plans = await MembershipPlan.find();
        res.status(200).json({ plans });
    } catch (error) {
        next(error);
    }
};

export const getMembershipPlanById: RequestHandler = async (req, res, next) => {
    const id = getIdParam(req.params.id);
    if (!id) {
        res.status(400).json({ message: "Invalid id" });
        return;
    }

    try {
        const plan = await MembershipPlan.findById(id);
        if (!plan) {
            res.status(404).json({ message: "Membership plan not found" });
            return;
        }

        res.status(200).json({ plan });
    } catch (error) {
        next(error);
    }
};

export const updateMembershipPlanById: RequestHandler = async (req, res, next) => {
    const id = getIdParam(req.params.id);
    if (!id) {
        res.status(400).json({ message: "Invalid id" });
        return;
    }

    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const parsed = updateMembershipPlanSchema.safeParse(req.body);
    if (!parsed.success) {
        console.warn("updateMembershipPlan validation failed", { requestId, errors: parsed.error.issues });
        res.status(400).json({ message: "Invalid payload", code: "INVALID_PAYLOAD", requestId, details: parsed.error.issues });
        return;
    }

    try {
        console.info("updateMembershipPlan request", { requestId, id, body: parsed.data });
        const updated = await MembershipPlan.findByIdAndUpdate(id, parsed.data, {
            returnDocument: "after",
            runValidators: true,
        });

        if (!updated) {
            res.status(404).json({ message: "Membership plan not found", requestId });
            return;
        }

        res.status(200).json({ message: "Membership plan updated", plan: updated, requestId });
    } catch (error: any) {
        if (error?.name === "MongoServerError" && error?.code === 11000) {
            console.warn("updateMembershipPlan duplicate key", { requestId, error: error.message });
            res.status(409).json({ message: "Duplicate resource", code: "DUPLICATE_RESOURCE", requestId, details: error.keyValue ?? null });
            return;
        }

        console.error("updateMembershipPlan error", { requestId, error: String(error), id });
        res.status(500).json({ message: "Failed to update membership plan", code: "INTERNAL_ERROR", requestId });
    }
};

export const deleteMembershipPlanById: RequestHandler = async (req, res, next) => {
    const id = getIdParam(req.params.id);
    if (!id) {
        res.status(400).json({ message: "Invalid id" });
        return;
    }

    try {
        const deleted = await MembershipPlan.findByIdAndDelete(id);
        if (!deleted) {
            res.status(404).json({ message: "Membership plan not found" });
            return;
        }

        res.status(200).json({ message: "Membership plan deleted" });
    } catch (error) {
        next(error);
    }
};
