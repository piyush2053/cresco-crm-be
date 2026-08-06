import { Router } from "express";
import { ReportsController } from "../controllers/reports.controller.js";
import { requiresAdmin, requiresAuth, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/user-time", requiresAdmin, ReportsController.userTime);
router.get("/user-time/sessions", requiresAdmin, ReportsController.userTimeSessions);
router.get("/user-time/daily", requiresAdmin, ReportsController.userTimeDaily);
router.get("/monthly", requiresPermission("reports", "read"), ReportsController.monthlyReport);
router.get("/dashboard", requiresPermission("dashboard", "read"), ReportsController.dashboard);
router.get("/bi/catalog",requiresPermission("reports","read"),ReportsController.catalog);
router.get("/bi/definitions",requiresPermission("reports","read"),ReportsController.reports);
router.post("/bi/definitions",requiresPermission("reports","create"),ReportsController.saveReport);
router.put("/bi/definitions/:id",requiresPermission("reports","update"),ReportsController.saveReport);
router.post("/bi/run",requiresPermission("reports","read"),ReportsController.run);
router.post("/bi/export/:format",requiresPermission("reports","export"),ReportsController.export);
router.get("/bi/dashboards",requiresPermission("reports","read"),ReportsController.dashboards);
router.post("/bi/dashboards",requiresPermission("reports","create"),ReportsController.createDashboard);
router.post("/bi/dashboards/:id/widgets",requiresPermission("reports","create"),ReportsController.addWidget);
router.put("/bi/dashboards/:id/reorder",requiresPermission("reports","update"),ReportsController.reorder);
router.get("/bi/schedules",requiresPermission("reports","read"),ReportsController.schedules);
router.post("/bi/schedules",requiresPermission("reports","create"),ReportsController.createSchedule);

export default router;
