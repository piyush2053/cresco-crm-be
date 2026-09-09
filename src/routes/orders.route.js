import { Router } from "express";
import { OrdersController as controller } from "../controllers/orders.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";

const router = Router();
router.use(requiresAuth);
const read = requiresPermission("orders", "read");
const create = requiresPermission("orders", "create");
const update = requiresPermission("orders", "update");
const remove = requiresPermission("orders", "delete");

router.get("/masters", read, controller.masters);
router.get("/operational", read, controller.operational);
router.get("/documents/:documentId", read, controller.document);
router.post("/pricing-preview", create, controller.pricingPreview);
router.get("/", read, controller.list);
router.post("/", create, controller.create);
router.get("/:id", read, controller.get);
router.post("/:id/products", update, controller.addProduct);
router.delete("/:id/products/:productId", remove, controller.removeProduct);
router.post("/:id/calculate", update, controller.calculate);
router.post("/:id/revisions", update, controller.revision);
router.put("/:id/stage", update, controller.stage);
router.post("/:id/communications", update, controller.communication);
router.post("/:id/generate", update, controller.generate);

export default router;
