import { WorkingCapitalService as s } from "../services/working-capital.service.js";
const w=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
export const WorkingCapitalController={
 masters:w(async(req,res)=>res.json(await s.masters())),dashboard:w(async(req,res)=>res.json(await s.dashboard())),
 createBank:w(async(req,res)=>res.status(201).json(await s.createBank(req.body))),updateBank:w(async(req,res)=>res.json(await s.updateBank(+req.params.id,req.body))),
 createAccount:w(async(req,res)=>res.status(201).json(await s.createAccount(req.body,req.user.id))),updateAccount:w(async(req,res)=>res.json(await s.updateAccount(+req.params.id,req.body,req.user.id))),rates:w(async(req,res)=>res.json(await s.rateHistory(+req.params.id))),
 list:w(async(req,res)=>res.json(await s.list(req.query))),summary:w(async(req,res)=>res.json(await s.summary(+req.params.id))),create:w(async(req,res)=>res.status(201).json(await s.create(req.body,req.user.id))),
 settle:w(async(req,res)=>res.json(await s.settle(+req.params.id,req.body,req.user.id))),history:w(async(req,res)=>res.json(await s.history(+req.params.id))),accrue:w(async(req,res)=>res.json(await s.accrue()))
};
