import {Router} from "express";import {SuppliersController as c} from "../controllers/suppliers.controller.js";import {requiresAuth,requiresPermission} from "../middlewares.js";
const r=Router();r.use(requiresAuth);const read=requiresPermission("suppliers","read"),write=requiresPermission("suppliers","update");
r.get("/settings",read,c.settings);r.put("/settings",write,c.updateSettings);r.get("/preferences",read,c.preferences);r.post("/preferences",write,c.savePreference);r.get("/resolve-procurement",read,c.resolve);
r.get("/",read,c.list);r.post("/",requiresPermission("suppliers","create"),c.create);r.get("/:id",read,c.get);r.put("/:id",write,c.update);r.delete("/:id",requiresPermission("suppliers","delete"),c.remove);
r.post("/:id/contacts",write,c.addContact);r.post("/:id/warehouses",write,c.addWarehouse);r.get("/warehouses/:warehouseId/catalogue",read,c.catalogue);r.post("/warehouses/:warehouseId/categories",write,c.addCategory);
r.put("/categories/:categoryId",write,c.renameCategory);r.delete("/categories/:categoryId",write,c.deleteCategory);r.post("/categories/:categoryId/grades",write,c.addGrade);r.put("/grades/:gradeId",write,c.renameGrade);r.delete("/grades/:gradeId",write,c.deleteGrade);r.put("/grades/:gradeId/price",write,c.savePrice);r.get("/grades/:gradeId/history",read,c.history);
export default r;
