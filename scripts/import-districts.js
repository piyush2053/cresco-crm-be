import ExcelJS from "exceljs";
import { getClient } from "../src/db.js";

const workbook=new ExcelJS.Workbook();
await workbook.xlsx.readFile(new URL("../DISTIRCTS.xlsx",import.meta.url));
const sheet=workbook.worksheets[0];
if(!sheet)throw new Error("DISTIRCTS.xlsx has no worksheet.");
const records=[];
let state="";
sheet.eachRow((row,index)=>{
  if(index===1)return;
  state=String(row.getCell(1).value??"").trim()||state;
  const name=String(row.getCell(2).value??"").trim();
  if(state&&name)records.push({state,name:name.toUpperCase()});
});
const client=await getClient();
try{
  await client.query("BEGIN");
  for(const record of records){
    const code=`DIST-${record.name.replace(/[^A-Z0-9]+/g,"-").slice(0,20)}-${record.state.replace(/[^A-Z0-9]+/gi,"-").toUpperCase().slice(0,8)}`;
    await client.query("INSERT INTO logistics_districts(name,state,code,data)VALUES($1,$2,$3,$4)ON CONFLICT(name,state)DO UPDATE SET is_active=true,updated_at=now(),data=logistics_districts.data||EXCLUDED.data",[record.name,record.state,code,{source:"DISTIRCTS.xlsx"}]);
  }
  await client.query("COMMIT");
  console.log(`District import complete: ${records.length} rows processed.`);
}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
