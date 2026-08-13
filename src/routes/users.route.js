import { Router } from "express";
import { UsersController } from "../controllers/users.controller.js";
import { requiresAuth, requiresAdmin, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/me/profile", UsersController.profile);
router.get("/", requiresPermission("users", "read"), UsersController.list);
router.get("/:id", requiresPermission("users", "read"), UsersController.get);
router.post("/create-request", requiresAdmin, UsersController.requestCreate);
router.post("/create-confirm", requiresAdmin, UsersController.confirmCreate);
router.put("/:id", requiresAdmin, UsersController.update);
router.post("/:id/delete-request", requiresAdmin, UsersController.requestRemoval);
router.delete("/:id", requiresAdmin, UsersController.remove);

export default router;
