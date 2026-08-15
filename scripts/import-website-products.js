import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getClient } from "../src/db.js";

const jsonPath=path.resolve(process.env.PRODUCTS_JSON_PATH||path.join(process.cwd(),"..","..","cresco-global","public","data","products.json"));
const sourceDir=path.resolve(process.env.PRODUCTS_ASSET_SOURCE_DIR||path.join(path.dirname(jsonPath),"..","products"));
const targetDir=path.resolve(process.env.PRODUCT_ASSET_DIR||path.join(process.cwd(),"product-assets"));
const slugify=value=>String(value||"").toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
const exists=async file=>{try{return(await stat(file)).isFile()}catch{return false}};
const verifiedAssetAliases=new Map([["TiONA-595 /592.pdf","TiONA-595 -592.pdf"]]);

function productSlugs(products){
  const grades={},bases={};
  for(const product of products){const grade=slugify(product.grade);grades[grade]=(grades[grade]||0)+1;}
  for(const product of products){const grade=slugify(product.grade),base=grades[grade]>1?`${grade}-${slugify(product.application)}`:grade;bases[base]=(bases[base]||0)+1;}
  return products.map(product=>{const grade=slugify(product.grade),base=grades[grade]>1?`${grade}-${slugify(product.application)}`:grade;return bases[base]>1?`${base}-${product.id}`:base;});
}

function assetName(value){
  if(!value)return null;
  let decoded;
  try{decoded=decodeURIComponent(String(value).replace(/^\/products\//,""));}catch{return null;}
  decoded=verifiedAssetAliases.get(decoded)||decoded;
  if(!decoded||decoded!==path.basename(decoded)||decoded.includes("/")||decoded.includes("\\")||path.extname(decoded).toLowerCase()!==".pdf")return null;
  return decoded;
}

async function main(){
  const products=JSON.parse(await readFile(jsonPath,"utf8"));
  if(!Array.isArray(products)||products.length!==121)throw new Error(`Expected exactly 121 products, found ${Array.isArray(products)?products.length:"invalid JSON"}.`);
  const slugs=productSlugs(products),client=await getClient(),missing=[],unsafe=[];
  let inserted=0,updated=0;
  await mkdir(path.join(targetDir,"datasheets"),{recursive:true});
  try{
    await client.query("BEGIN");
    for(let index=0;index<products.length;index+=1){
      const p=products[index],name=assetName(p.datasheet),sampleName=assetName(p.sample);
      if(p.datasheet&&!name)unsafe.push({id:p.id,field:"datasheet",value:p.datasheet});
      if(p.sample&&!sampleName)unsafe.push({id:p.id,field:"sample",value:p.sample});
      for(const filename of new Set([name,sampleName].filter(Boolean))){
        const source=path.join(sourceDir,filename),target=path.join(targetDir,"datasheets",filename);
        if(await exists(source)){if(!(await exists(target)))await copyFile(source,target);}
        else if(!(await exists(target)))missing.push({id:p.id,filename});
      }
      const values=[p.id,String(p.company||"").trim(),String(p.country||"").trim(),String(p.method||"").trim(),String(p.grade||"").trim(),String(p.application||"").trim(),String(p.description||"").trim(),slugs[index],name?`datasheets/${name}`:null,sampleName?`datasheets/${sampleName}`:null,index];
      const result=await client.query(`INSERT INTO website_products(legacy_id,company,country,method,grade,application,description,slug,datasheet_path,sample_path,sort_order)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(legacy_id) DO UPDATE SET company=EXCLUDED.company,country=EXCLUDED.country,method=EXCLUDED.method,grade=EXCLUDED.grade,application=EXCLUDED.application,description=EXCLUDED.description,updated_at=now()
        RETURNING (xmax=0) inserted`,values);
      result.rows[0].inserted?inserted++:updated++;
    }
    await client.query("SELECT setval(pg_get_serial_sequence('website_products','id'),GREATEST(COALESCE((SELECT max(id) FROM website_products),1),1),true)");
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
  const uniqueMissing=[...new Map(missing.map(x=>[x.filename,x])).values()];
  console.log(JSON.stringify({source:jsonPath,total:products.length,inserted,updated,missingFiles:uniqueMissing,unsafeReferences:unsafe},null,2));
}

main().then(()=>process.exit(0)).catch(error=>{console.error(error.stack||error.message);process.exit(1)});
