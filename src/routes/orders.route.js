import { Router } from "express";
import { OrdersController as controller } from "../controllers/orders.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";
import { OrderFlowService, flowAccess, redactOrderData } from '../services/order-flow.service.js';
const flowWrap = handler => (req,res,next) => Promise.resolve(handler(req,res)).catch(next);

const router = Router();
router.use(requiresAuth);
router.use((req,res,next)=>flowAccess(req.user).then(access=>{
  const json=res.json.bind(res);
  res.json=value=>json(redactOrderData(value,access.margin));
  next();
}).catch(next));
const read = requiresPermission("orders", "read");
const create = requiresPermission("orders", "create");
const update = requiresPermission("orders", "update");
const remove = requiresPermission("orders", "delete");

router.get("/masters", read, controller.masters);
router.get('/flow-metadata', read, flowWrap(async(req,res)=>res.json(await OrderFlowService.metadata(req.user))));
router.get('/flows', read, flowWrap(async(req,res)=>res.json(await OrderFlowService.list(req.query))));
router.get('/:id/flow', read, flowWrap(async(req,res)=>res.json(await OrderFlowService.get(+req.params.id,req.user))));
router.get('/:id/flow/quotation', read, flowWrap(async(req,res)=>res.json(await OrderFlowService.quotation(+req.params.id))));
router.get('/:id/flow/suppliers', read, flowWrap(async(req,res)=>res.json(await OrderFlowService.suppliers(+req.params.id))));
router.post('/:id/flow', update, flowWrap(async(req,res)=>res.json(await OrderFlowService.save(+req.params.id,req.body,req.user))));
router.get("/ex-cresco-prices", read, controller.exCrescoPrices);
router.post("/ex-cresco-prices", create, controller.addExCrescoPrice);
router.delete("/ex-cresco-prices/:priceId", remove, controller.deactivateExCrescoPrice);
router.get("/quotation-settings", read, controller.quotationSettings);
router.put("/quotation-settings", update, controller.updateQuotationSettings);
router.get("/operational", read, controller.operational);
router.get("/documents/:documentId", read, controller.document);
router.post("/pricing-preview", create, controller.pricingPreview);
router.post("/procurement-preview", update, controller.procurementPreview);
router.get("/", read, controller.list);
router.post("/", create, controller.create);
router.get("/:id", read, controller.get);
router.post("/:id/products", update, controller.addProduct);
router.delete("/:id/products/:productId", remove, controller.removeProduct);
router.post("/:id/convert-to-order", update, controller.convertToOrder);
router.put("/:id/products/:productId/quote-override", update, controller.overrideQuote);
router.post("/:id/revisions", update, controller.revision);
router.put("/:id/stage", update, controller.stage);
router.post("/:id/communications", update, controller.communication);
router.post("/:id/generate", update, controller.generate);

export default router;
