import { Router } from "express";
import { createLead, getDashboardData, getLeadById } from "../controllers/leadsController";
import { leadsLimiter } from "../middlewares/rateLimiter";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.post("/", leadsLimiter, createLead);
router.get("/dashboard", requireAuth, getDashboardData);
router.get("/:id", requireAuth, getLeadById);

export default router;
