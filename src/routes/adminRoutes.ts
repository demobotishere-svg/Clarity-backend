import { Router } from "express";
import { setupAdmin, getTableData } from "../controllers/adminController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.post("/setup", requireAuth, setupAdmin);
router.get("/tables/:tableName", requireAuth, getTableData);

export default router;
