import { Router } from "express";
import { RolesController } from "../controllers/roles.controller.js";
import { requiresAuth, requiresAdmin, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/", requiresPermission("roles", "read"), RolesController.list);
router.post("/", requiresAdmin, RolesController.create);
router.put("/:id", requiresAdmin, RolesController.update);
router.delete("/:id", requiresAdmin, RolesController.remove);

export default router;
