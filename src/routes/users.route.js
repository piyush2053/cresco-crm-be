import { Router } from "express";
import { UsersController } from "../controllers/users.controller.js";
import { requiresAuth, requiresAdmin, requiresPermission } from "../middlewares.js";

const router = Router();

router.use(requiresAuth);
router.get("/me/profile", UsersController.profile);
router.get("/", requiresPermission("users", "read"), UsersController.list);
router.get("/:id", requiresPermission("users", "read"), UsersController.get);
router.post("/", requiresAdmin, UsersController.create);
router.put("/:id", requiresAdmin, UsersController.update);
router.delete("/:id", requiresAdmin, UsersController.remove);

export default router;
