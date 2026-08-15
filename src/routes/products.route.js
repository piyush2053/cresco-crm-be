import { mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { ProductsController as c } from "../controllers/products.controller.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";

const destination=path.join(config.productAssets.directory,"datasheets");
mkdirSync(destination,{recursive:true});
const upload=multer({
  storage:multer.diskStorage({destination,filename:(req,file,done)=>done(null,`${Date.now()}-${crypto.randomUUID()}.pdf`)}),
  limits:{fileSize:15*1024*1024},
  fileFilter:(req,file,done)=>{
    const validMime=file.mimetype==="application/pdf",validExtension=path.extname(file.originalname).toLowerCase()===".pdf";
    return validMime&&validExtension?done(null,true):done(Object.assign(new Error("Only PDF datasheets are allowed."),{status:400}));
  },
});

const router=Router();
router.use(requiresAuth);
router.get("/",requiresPermission("website_products","read"),c.list);
router.get("/:id",requiresPermission("website_products","read"),c.get);
router.post("/",requiresPermission("website_products","create"),c.create);
router.put("/:id",requiresPermission("website_products","update"),c.update);
router.delete("/:id",requiresPermission("website_products","delete"),c.remove);
router.post("/:id/datasheet",requiresPermission("website_products","update"),upload.single("datasheet"),c.uploadDatasheet);
export default router;

export const publicProductsRouter=Router();
publicProductsRouter.get("/products",c.publicList);
