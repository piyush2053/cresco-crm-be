import { Router } from "express";
import { EnquiriesController } from "../controllers/enquiries.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/", requiresPermission("enquiries", "read"), EnquiriesController.list);
router.get("/:id", requiresPermission("enquiries", "read"), EnquiriesController.get);
router.post("/", requiresPermission("enquiries", "create"), EnquiriesController.create);
router.put("/:id", requiresPermission("enquiries", "update"), EnquiriesController.update);
router.delete("/:id", requiresPermission("enquiries", "delete"), EnquiriesController.remove);

export default router;
