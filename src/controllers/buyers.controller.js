import { BuyersService } from "../services/buyers.service.js";
const fail = (res, error) => error.code === "23505" ? res.status(409).json({ message: "PAN must be unique for each Buyer Group." }) : Promise.reject(error);
export const BuyersController = {
  async list(req,res){ return res.json(await BuyersService.list(req.query)); },
  async get(req,res){ const row=await BuyersService.get(Number(req.params.id)); return row ? res.json(row) : res.status(404).json({message:"Buyer not found."}); },
  async create(req,res){ try{return res.status(201).json(await BuyersService.create(req.body,req.user.id));}catch(e){return fail(res,e);} },
  async update(req,res){ try{return res.json(await BuyersService.update(Number(req.params.id),req.body,req.user.id));}catch(e){return fail(res,e);} },
  async remove(req,res){return res.json(await BuyersService.remove(Number(req.params.id)));},
  async addContact(req,res){return res.status(201).json(await BuyersService.addContact(Number(req.params.id),req.body));},
  async updateContact(req,res){return res.json(await BuyersService.updateContact(Number(req.params.id),Number(req.params.contactId),req.body));},
  async addLocation(req,res){return res.status(201).json(await BuyersService.addLocation(Number(req.params.id),req.body));},
  async masters(req,res){return res.json(await BuyersService.masters());},
  async bulkUpload(req,res){
    if(!req.file)return res.status(400).json({message:"Please select an Excel file."});
    return res.json(await BuyersService.bulkUpload(req.file.originalname,req.file.buffer,req.user.id));
  },
  async analyzeUpload(req,res){
    if(!req.file)return res.status(400).json({message:"Please select an Excel file."});
    return res.json(await BuyersService.analyzeUpload(req.file.originalname,req.file.buffer));
  },
  async downloadTemplate(req,res){
    const buffer=await BuyersService.uploadTemplate();
    res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition",'attachment; filename="buyer-gst-upload-template.xlsx"');
    return res.send(buffer);
  },
};
