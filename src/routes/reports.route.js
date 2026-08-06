import { Router } from "express";
import { ReportsController } from "../controllers/reports.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/weekly", requiresPermission("reports", "read"), ReportsController.weeklyReport);
router.get("/dashboard", requiresPermission("dashboard", "read"), ReportsController.dashboard);

export default router;
