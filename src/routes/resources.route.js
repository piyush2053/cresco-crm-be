import { Router } from "express";
import { ResourcesService } from "../services/resources.service.js";
import { requiresAuth, requiresPermission } from "../middlewares.js";
const router = Router(); const names = ["finance"];
for (const name of names) { router.get(`/${name}`, requiresAuth, requiresPermission(name,"read"), async (req,res,next)=>{try{res.json(await ResourcesService.list(name));}catch(e){next(e);}}); router.post(`/${name}`, requiresAuth, requiresPermission(name,"create"), async(req,res,next)=>{try{res.status(201).json(await ResourcesService.create(name,req.body));}catch(e){next(e);}}); router.put(`/${name}/:id`, requiresAuth, requiresPermission(name,"update"), async(req,res,next)=>{try{res.json(await ResourcesService.update(name,Number(req.params.id),req.body));}catch(e){next(e);}}); router.delete(`/${name}/:id`, requiresAuth, requiresPermission(name,"delete"), async(req,res,next)=>{try{res.json(await ResourcesService.remove(name,Number(req.params.id)));}catch(e){next(e);}}); }
export default router;
