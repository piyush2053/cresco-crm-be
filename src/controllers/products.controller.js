import { rm } from "node:fs/promises";
import { ProductsService } from "../services/products.service.js";

const id = (req) => Number.parseInt(req.params.id, 10);
export const ProductsController = {
  async list(req,res){res.json(await ProductsService.list(req.query));},
  async get(req,res){const row=await ProductsService.get(id(req));return row?res.json(row):res.status(404).json({message:"Website product not found."});},
  async create(req,res){res.status(201).json(await ProductsService.create(req.body,req.user.id));},
  async update(req,res){const row=await ProductsService.update(id(req),req.body,req.user.id);return row?res.json(row):res.status(404).json({message:"Website product not found."});},
  async remove(req,res){const row=await ProductsService.remove(id(req));return row?res.json({message:"Website product deleted."}):res.status(404).json({message:"Website product not found."});},
  async uploadDatasheet(req,res){
    if(!req.file)return res.status(400).json({message:"Please select a PDF, XLSX or CSV datasheet."});
    const relative=`datasheets/${req.file.filename}`;
    try{
      const previous=await ProductsService.get(id(req));
      if(!previous){await rm(req.file.path,{force:true});return res.status(404).json({message:"Website product not found."});}
      const row=await ProductsService.attachDatasheet(id(req),relative,req.user.id);
      if(previous.datasheet_path&&previous.datasheet_path!==relative)await ProductsService.removeIfUnreferenced(previous.datasheet_path);
      return res.json(row);
    }catch(error){await rm(req.file.path,{force:true});throw error;}
  },
  async uploadImage(req,res){
    if(!req.file)return res.status(400).json({message:"Please select a product image."});
    const relative=`images/${req.file.filename}`;
    try{
      const previous=await ProductsService.get(id(req));
      if(!previous){await rm(req.file.path,{force:true});return res.status(404).json({message:"Website product not found."});}
      const row=await ProductsService.attachImage(id(req),relative,req.user.id);
      if(previous.image_path&&previous.image_path!==relative)await ProductsService.removeIfUnreferenced(previous.image_path);
      return res.json(row);
    }catch(error){await rm(req.file.path,{force:true});throw error;}
  },
  async publicList(req,res){res.json(await ProductsService.publicList());},
};
