import { Router } from "express";
import { queueBulkMessages, getBulkReports, getBulkReportById } from "../controllers/bulkController";
import { requireAuth } from "../middlewares/authMiddleware";

const router = Router();

router.post("/queue", requireAuth, queueBulkMessages);
router.get("/reports", requireAuth, getBulkReports);
router.get("/reports/:id", requireAuth, getBulkReportById);

export default router;
