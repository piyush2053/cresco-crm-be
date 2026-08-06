import { Router } from "express";
import multer from "multer";
import { UploadsController } from "../controllers/uploads.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(requiresAuth);
router.post("/supplier-template", requiresPermission("uploads", "create"), upload.single("file"), UploadsController.uploadSupplierTemplate);
router.get("/status", requiresPermission("uploads", "read"), UploadsController.status);

export default router;
