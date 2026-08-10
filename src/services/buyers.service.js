import { query, getClient } from "../db.js";
import { safeJson } from "../utils.js";
import ExcelJS from "exceljs";

const BUYER_FIELDS = ["group_name", "pan", "gst_slab", "state", "group_tag", "reference", "parent_location", "remark", "lead_manager", "lead_type", "monthly_consumption", "call_date", "next_call_date", "call_remark", "profile_shared", "quote_shared", "order_status", "credit_interest"];
const CONTACT_FIELDS = ["name", "department", "designation", "mobile_number", "email_address", "whatsapp_number", "notes", "is_primary"];
const LOCATION_FIELDS = ["name", "gst_number", "pan", "address", "city", "state", "delivery_preferences", "credit_terms"];
const UPLOAD_HEADERS=["PAN","PAN to GST Status","GST","status","errdata","BUSINESS TYPE","data_basicDetails_aadharVerified","data_basicDetails_Legal_Name","data_basicDetails_gstin","data_basicDetails_Ekyc_Flag","data_basicDetails_compositionRate","BUSINESS CONSTITUTION","data_basicDetails_tradeNam","data_basicDetails_aadharVerDate","data_basicDetails_ctj","data_basicDetails_percentTaxInCash","data_basicDetails_mandatedeInvoice","data_basicDetails_aggreTurnOverFY","data_basicDetails_jurisdiction","data_basicDetails_registrationType","data_basicDetails_aggreTurnOver","data_basicDetails_cancelationDate","data_basicDetails_businessNature","data_basicDetails_registrationDate","data_basicDetails_registrationStatus","data_basicDetails_ekycVdt","data_basicDetails_percentTaxInCashFY","data_basicDetails_einvoiceStatus","data_basicDetails_memberDetails","data_basicDetails_mobile","data_basicDetails_email","data_hsnDetails_goods","data_branchDetails_permanentAdd_address","data_branchDetails_permanentAdd_dealsIn","data_branchDetails_additionalAdd"];
const PAN_RE=/^[A-Z]{5}[0-9]{4}[A-Z]$/, GST_RE=/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const clean=v=>v===null||v===undefined?"":String(v).trim();
const phone=v=>clean(v).replace(/\D/g,"").replace(/^91(?=\d{10}$)/,"");
function jsonArray(value){try{const parsed=JSON.parse(clean(value)||"[]");return Array.isArray(parsed)?parsed:[]}catch{return []}}
function stateFrom(row){const jurisdiction=clean(row.data_basicDetails_jurisdiction);const match=jurisdiction.match(/State\s*-\s*([^,]+)/i);return match?.[1]?.trim()||""}
function businessType(value){const codes=clean(value).toUpperCase().split(/[:;,/\s]+/);const labels=[];if(codes.includes("TRD"))labels.push("TRADER");if(codes.includes("MFT"))labels.push("MANUFACTURER");return labels.join(", ")||clean(value)}
function rowError(item){const r=item.data,pan=clean(r.PAN).toUpperCase(),gst=clean(r.data_basicDetails_gstin||r.GST).toUpperCase();if(clean(r.status).toUpperCase()!=="SUCCESS")return clean(r.errdata)||"Source row status is not SUCCESS";if(!PAN_RE.test(pan))return `Invalid PAN: ${pan||"blank"}`;if(!GST_RE.test(gst))return `Invalid GSTIN: ${gst||"blank"}`;if(gst.slice(2,12)!==pan)return "GSTIN PAN does not match the PAN column";return null}
async function invalidWorkbook(items){const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet("Invalid Rows");sheet.columns=[{header:"Source Row",key:"sourceRow",width:12},...UPLOAD_HEADERS.map(h=>({header:h,key:h,width:Math.min(Math.max(h.length+2,16),42)})),{header:"CRM Import Error",key:"error",width:48}];sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];for(const x of items)sheet.addRow({sourceRow:x.rowNumber,...x.data,error:x.error});return wb.xlsx.writeBuffer()}
async function parseBuyerWorkbook(buffer){
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0];
  if(!sheet)throw Object.assign(new Error("Uploaded file has no worksheet."),{status:400});
  const actual=sheet.getRow(1).values.slice(1).map(clean);const missing=UPLOAD_HEADERS.filter(h=>!actual.includes(h));
  if(missing.length)throw Object.assign(new Error(`Invalid Buyer file. Missing headings: ${missing.join(", ")}`),{status:400});
  const rows=[];for(let n=2;n<=sheet.rowCount;n++){const values=sheet.getRow(n).values;const row={};actual.forEach((h,i)=>row[h]=values[i+1]??null);if(Object.values(row).some(v=>clean(v)))rows.push({rowNumber:n,data:row})}
  if(!rows.length)throw Object.assign(new Error("The uploaded file has no data rows."),{status:400});return rows;
}

function addWhere(values, clauses, value, expression) {
  if (value === undefined || value === null || value === "") return;
  values.push(value);
  clauses.push(expression(values.length));
}

export const BuyersService = {
  async list(params) {
    const values = [], clauses = [];
    addWhere(values, clauses, params.search, (n) => `to_tsvector('simple', concat_ws(' ', b.group_name,b.pan,b.state,b.group_tag,b.reference,b.remark,pc.name,pc.mobile_number)) @@ plainto_tsquery('simple',$${n})`);
    for (const field of ["state", "group_tag", "lead_manager", "order_status"]) addWhere(values, clauses, params[field], (n) => `b.${field} = ANY(string_to_array($${n}, ','))`);
    const sortable = new Map([
      ["group_name","b.group_name"],["pan","b.pan"],["gst_slab","b.gst_slab"],["state","b.state"],["group_tag","b.group_tag"],
      ["reference","b.reference"],["remark","b.remark"],["lead_manager","b.lead_manager"],["parent_location","b.parent_location"],
      ["primary_contact_number","primary_contact_number"],["primary_contact_name","primary_contact_name"],["primary_contact_designation","primary_contact_designation"],
      ["grades","grades"],["application","application"],["sub_application","sub_application"],["hsn_code","hsn_code"],
      ["created_at","b.created_at"],["next_call_date","b.next_call_date"]
    ]);
    const sort = sortable.get(params.sort) || "b.created_at";
    const direction = params.direction === "asc" ? "ASC" : "DESC";
    const page = Math.max(Number(params.page) || 1, 1), limit = Math.min(Math.max(Number(params.limit) || 50, 1), 200);
    values.push(limit, (page - 1) * limit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT b.*, pc.name primary_contact_name, pc.mobile_number primary_contact_number,
      pc.designation primary_contact_designation,
      COALESCE((SELECT string_agg(mv.label, ', ' ORDER BY mv.label) FROM buyer_master_links l JOIN buyer_master_values mv ON mv.id=l.master_value_id WHERE l.buyer_id=b.id AND mv.master_type='grade'),'') grades,
      COALESCE((SELECT string_agg(mv.label, ', ' ORDER BY mv.label) FROM buyer_master_links l JOIN buyer_master_values mv ON mv.id=l.master_value_id WHERE l.buyer_id=b.id AND mv.master_type='application'),'') application,
      COALESCE((SELECT string_agg(mv.label, ', ' ORDER BY mv.label) FROM buyer_master_links l JOIN buyer_master_values mv ON mv.id=l.master_value_id WHERE l.buyer_id=b.id AND mv.master_type='sub_application'),'') sub_application,
      COALESCE((SELECT string_agg(mv.label, ', ' ORDER BY mv.label) FROM buyer_master_links l JOIN buyer_master_values mv ON mv.id=l.master_value_id WHERE l.buyer_id=b.id AND mv.master_type='hsn_code'),'') hsn_code,
      count(*) OVER() total_count
      FROM buyers b LEFT JOIN buyer_contacts pc ON pc.buyer_id=b.id AND pc.is_primary ${where} ORDER BY ${sort} ${direction} LIMIT $${values.length - 1} OFFSET $${values.length}`;
    const result = await query(sql, values);
    return { data: result.rows.map(safeJson), page, limit, total: Number(result.rows[0]?.total_count || 0) };
  },

  async get(id) {
    const buyer = (await query("SELECT *, GREATEST(0, CURRENT_DATE-call_date) days_since_last_call, GREATEST(0, next_call_date-CURRENT_DATE) follow_up_days, CASE WHEN order_count=0 THEN 'Prospect' WHEN last_order_date<CURRENT_DATE-180 THEN 'Dormant Customer' WHEN order_count=1 THEN 'Active Customer' ELSE 'Repeat Customer' END calculated_lifecycle_status FROM buyers WHERE id=$1", [id])).rows[0];
    if (!buyer) return null;
    const [contacts, locations, interests, customFields, activities, transactions] = await Promise.all([
      query("SELECT DISTINCT c.* FROM buyer_contacts c LEFT JOIN buyer_contact_locations cl ON cl.contact_id=c.id LEFT JOIN buyer_locations l ON l.id=cl.location_id WHERE c.buyer_id=$1 OR l.buyer_id=$1 ORDER BY c.is_primary DESC,c.created_at", [id]),
      query("SELECT l.*,COALESCE(json_agg(json_build_object('contact_id',cl.contact_id,'phone_number',cl.phone_number,'email_address',cl.email_address)) FILTER (WHERE cl.contact_id IS NOT NULL),'[]') contacts FROM buyer_locations l LEFT JOIN buyer_contact_locations cl ON cl.location_id=l.id WHERE l.buyer_id=$1 GROUP BY l.id ORDER BY l.created_at", [id]),
      query("SELECT mv.* FROM buyer_master_links l JOIN buyer_master_values mv ON mv.id=l.master_value_id WHERE l.buyer_id=$1 ORDER BY mv.master_type,mv.label", [id]),
      query("SELECT d.id,d.field_key,d.label,d.field_type,d.options,v.value FROM buyer_custom_field_definitions d LEFT JOIN buyer_custom_field_values v ON v.definition_id=d.id AND v.buyer_id=$1 WHERE d.is_active ORDER BY d.sort_order,d.id", [id]),
      query("SELECT * FROM buyer_activities WHERE buyer_id=$1 ORDER BY occurred_at DESC LIMIT 100", [id]),
      query("SELECT id,inquiry_number,inquiry_date,current_stage,status,(SELECT COALESCE(sum(quantity_kg*COALESCE(quoted_price,final_quotation_price)),0) FROM sales_transaction_products WHERE transaction_id=t.id) current_quote FROM sales_transactions t WHERE buyer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",[id]),
    ]);
    return safeJson({ ...buyer, contacts: contacts.rows, locations: locations.rows, interests: interests.rows, custom_fields: customFields.rows, activities: activities.rows, transactions: transactions.rows });
  },

  async create(payload, userId) {
    try {
      const columns = BUYER_FIELDS.filter((f) => payload[f] !== undefined);
      const values = columns.map((f) => payload[f]);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(",");
      const buyer = (await query(`INSERT INTO buyers (${columns.join(",")}) VALUES (${placeholders}) RETURNING *`, values)).rows[0];
      if (payload.primary_contact_name || payload.primary_contact_number) await this.addContact(buyer.id, { name: payload.primary_contact_name, mobile_number: payload.primary_contact_number, designation: payload.primary_contact_designation, is_primary: true });
      await this.setInterests(buyer.id, payload.interest_ids || []);
      await query("INSERT INTO buyer_activities (buyer_id,activity_type,description,created_by) VALUES ($1,'buyer_created','Buyer group created',$2)", [buyer.id, userId]);
      return this.get(buyer.id);
    } catch (error) { throw error; }
  },

  async update(id, payload, userId) {
    const fields = BUYER_FIELDS.filter((f) => payload[f] !== undefined);
    if (fields.length) {
      const values = fields.map((f) => payload[f]); values.push(id);
      await query(`UPDATE buyers SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(",")},updated_at=now() WHERE id=$${values.length}`, values);
    }
    if (payload.interest_ids) await this.setInterests(id, payload.interest_ids);
    await query("INSERT INTO buyer_activities (buyer_id,activity_type,description,created_by) VALUES ($1,'buyer_updated','Buyer profile updated',$2)", [id, userId]);
    return this.get(id);
  },

  async addContact(buyerId, payload) {
    const fields = CONTACT_FIELDS.filter((f) => payload[f] !== undefined);
    const values = [buyerId, ...fields.map((f) => payload[f])];
    const result = await query(`INSERT INTO buyer_contacts (buyer_id,${fields.join(",")}) VALUES ($1,${fields.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`, values);
    return safeJson(result.rows[0]);
  },
  async updateContact(buyerId, contactId, payload) {
    const fields = CONTACT_FIELDS.filter((f) => payload[f] !== undefined); if (!fields.length) return null;
    const values = fields.map((f) => payload[f]); values.push(buyerId, contactId);
    return safeJson((await query(`UPDATE buyer_contacts SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(",")} WHERE buyer_id=$${values.length - 1} AND id=$${values.length} RETURNING *`, values)).rows[0]);
  },
  async addLocation(buyerId, payload) {
    const fields = LOCATION_FIELDS.filter((f) => payload[f] !== undefined), values = [buyerId, ...fields.map((f) => payload[f])];
    return safeJson((await query(`INSERT INTO buyer_locations (buyer_id,${fields.join(",")}) VALUES ($1,${fields.map((_, i) => `$${i + 2}`).join(",")}) RETURNING *`, values)).rows[0]);
  },
  async setInterests(buyerId, ids) {
    await query("DELETE FROM buyer_master_links WHERE buyer_id=$1", [buyerId]);
    for (const id of ids) await query("INSERT INTO buyer_master_links (buyer_id,master_value_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [buyerId, id]);
  },
  async remove(id) { await query("DELETE FROM buyers WHERE id=$1", [id]); return { message: "Buyer removed." }; },
  async masters() { return (await query("SELECT * FROM buyer_master_values WHERE is_active ORDER BY master_type,label")).rows.map(safeJson); },
  async uploadTemplate(){const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet("Buyer GST Upload");sheet.addRow(UPLOAD_HEADERS);sheet.getRow(1).font={bold:true};sheet.views=[{state:"frozen",ySplit:1}];sheet.columns=UPLOAD_HEADERS.map(h=>({header:h,key:h,width:Math.min(Math.max(h.length+2,16),42)}));return wb.xlsx.writeBuffer()},
  async analyzeUpload(filename,buffer){
    if(!/\.xlsx$/i.test(filename))throw Object.assign(new Error("Only .xlsx Buyer files are supported."),{status:400});
    const input=await parseBuyerWorkbook(buffer),invalid=input.map(x=>({...x,error:rowError(x)})).filter(x=>x.error),valid=input.filter(x=>!rowError(x));
    const pans=[...new Set(valid.map(x=>clean(x.data.PAN).toUpperCase()))],gstins=[...new Set(valid.map(x=>clean(x.data.data_basicDetails_gstin||x.data.GST).toUpperCase()))];
    const [existingPans,existingGstins]=await Promise.all([pans.length?query("SELECT upper(pan) value FROM buyers WHERE upper(pan)=ANY($1)",[pans]):{rows:[]},gstins.length?query("SELECT upper(gst_number) value FROM buyer_locations WHERE upper(gst_number)=ANY($1)",[gstins]):{rows:[]}]);
    const panSet=new Set(existingPans.rows.map(x=>x.value)),gstSet=new Set(existingGstins.rows.map(x=>x.value)),report=invalid.length?await invalidWorkbook(invalid):null;
    return{filename,totalRows:input.length,validRows:valid.length,invalidRows:invalid.length,groupsToCreate:pans.filter(x=>!panSet.has(x)).length,groupsToUpdate:pans.filter(x=>panSet.has(x)).length,locationsToCreate:gstins.filter(x=>!gstSet.has(x)).length,locationsToUpdate:gstins.filter(x=>gstSet.has(x)).length,issues:invalid.map(x=>({row:x.rowNumber,message:x.error,pan:clean(x.data.PAN),gstin:clean(x.data.data_basicDetails_gstin||x.data.GST)})),invalidReport:report?Buffer.from(report).toString("base64"):null};
  },
  async bulkUpload(filename,buffer,userId){
    if(!/\.xlsx$/i.test(filename))throw Object.assign(new Error("Only .xlsx Buyer files are supported."),{status:400});
    const input=await parseBuyerWorkbook(buffer),client=await getClient();const stats={rows:input.length,groupsCreated:0,groupsUpdated:0,locationsCreated:0,locationsUpdated:0,contactsCreated:0,contactsReused:0,linksCreated:0,skipped:0,errors:[]};
    try{await client.query("BEGIN");for(const item of input){const r=item.data,pan=clean(r.PAN).toUpperCase(),gst=clean(r.data_basicDetails_gstin||r.GST).toUpperCase();
      const error=rowError(item);if(error){stats.skipped++;stats.errors.push({row:item.rowNumber,message:error});continue}
      const groupName=clean(r.data_basicDetails_tradeNam)||clean(r.data_basicDetails_Legal_Name)||pan;
      let group=(await client.query("SELECT id FROM buyers WHERE upper(pan)=$1",[pan])).rows[0];
      if(!group){group=(await client.query("INSERT INTO buyers(group_name,pan,state,gst_slab) VALUES($1,$2,$3,$4) RETURNING id",[groupName,pan,stateFrom(r),clean(r.data_basicDetails_compositionRate)])).rows[0];stats.groupsCreated++}else{await client.query("UPDATE buyers SET group_name=COALESCE(NULLIF($2,''),group_name),state=COALESCE(NULLIF($3,''),state),updated_at=now() WHERE id=$1",[group.id,groupName,stateFrom(r)]);stats.groupsUpdated++}
      let location=(await client.query("SELECT id FROM buyer_locations WHERE upper(gst_number)=$1",[gst])).rows[0];const locationValues=[group.id,groupName,gst,pan,clean(r.data_branchDetails_permanentAdd_address),stateFrom(r),businessType(r["BUSINESS TYPE"]),clean(r.data_basicDetails_aggreTurnOver),"data_basicDetails_aggreTurnOver",clean(r.data_basicDetails_registrationStatus),clean(r["BUSINESS CONSTITUTION"])];
      if(!location){location=(await client.query("INSERT INTO buyer_locations(buyer_id,name,gst_number,pan,address,state,business_type,turnover,turnover_heading,registration_status,business_constitution) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id",locationValues)).rows[0];stats.locationsCreated++}else{await client.query("UPDATE buyer_locations SET buyer_id=$1,name=$2,pan=$4,address=$5,state=$6,business_type=$7,turnover=$8,turnover_heading=$9,registration_status=$10,business_constitution=$11,updated_at=now() WHERE id=$3",[...locationValues.slice(0,2),location.id,...locationValues.slice(3)]);stats.locationsUpdated++}
      const names=jsonArray(r.data_basicDetails_memberDetails).map(clean).filter(Boolean);if(!names.length)names.push(clean(r.data_basicDetails_Legal_Name)||groupName);const rowPhone=phone(r.data_basicDetails_mobile),rowEmail=clean(r.data_basicDetails_email).toLowerCase();
      for(let i=0;i<names.length;i++){const p=i===0?rowPhone:"",email=i===0?rowEmail:"";let contact=p?(await client.query("SELECT id FROM buyer_contacts WHERE regexp_replace(mobile_number,'[^0-9]','','g')=$1 ORDER BY id LIMIT 1",[p])).rows[0]:null;if(!contact)contact=(await client.query("SELECT id FROM buyer_contacts WHERE buyer_id=$1 AND lower(btrim(name))=lower($2) ORDER BY id LIMIT 1",[group.id,names[i]])).rows[0];
        if(!contact){contact=(await client.query("INSERT INTO buyer_contacts(buyer_id,name,mobile_number,email_address,is_primary) VALUES($1,$2,$3,$4,$5) RETURNING id",[group.id,names[i],p||null,email||null,i===0&&!((await client.query("SELECT 1 FROM buyer_contacts WHERE buyer_id=$1 AND is_primary",[group.id])).rowCount)])).rows[0];stats.contactsCreated++}else stats.contactsReused++;
        const linked=await client.query("INSERT INTO buyer_contact_locations(contact_id,location_id,phone_number,email_address,source_row) VALUES($1,$2,$3,$4,$5) ON CONFLICT(contact_id,location_id) DO UPDATE SET phone_number=EXCLUDED.phone_number,email_address=EXCLUDED.email_address,source_row=EXCLUDED.source_row,updated_at=now() RETURNING (xmax=0) inserted",[contact.id,location.id,p||null,email||null,item.rowNumber]);if(linked.rows[0]?.inserted)stats.linksCreated++;
      }
      await client.query("INSERT INTO buyer_activities(buyer_id,activity_type,description,metadata,created_by) VALUES($1,'bulk_upload','Buyer data synced from Excel',$2,$3)",[group.id,JSON.stringify({filename,row:item.rowNumber,gstin:gst}),userId]);
    }await client.query("COMMIT");return stats}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
  },
};
