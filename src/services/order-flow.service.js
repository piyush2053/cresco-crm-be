import { createHash } from 'node:crypto';
import { getClient as dbGetClient, query as dbQuery } from '../db.js';
import { stages, nestedSchemas, schemaFor, validate, fail, transition, creditResult, deliveredPrice, capacity } from './order-flow.rules.js';
import { proformaInvoiceHtml } from '../templates/proforma-invoice.template.js';

export async function flowAccess(user, run = dbQuery) {
  const role = (await run('SELECT name,permissions FROM roles WHERE id=$1', [user.role_id])).rows[0];
  const scoped=(await run("SELECT permissions FROM settings_access_permissions WHERE role_id=$1 AND scope_type='Module' AND scope_key='orders'",[user.role_id])).rows[0];
  const update=scoped?scoped.permissions?.edit===true:role?.permissions?.modules?.orders===true&&role?.permissions?.actions?.update===true;
  const name = String(role?.name || '').toLowerCase();
  const admin = user.is_admin === true;
  return { admin, update, manager: admin || name === 'manager', sales: name === 'sales', accounts: name === 'accounts', team: ['order team','order management'].includes(name), margin: admin || name === 'accounts' || role?.permissions?.orders?.margin === true };
}
const access = flowAccess;
export function redactOrderData(value, margin) {
  if (margin || value == null || typeof value !== 'object') return value;
  if(value instanceof Date)return value.toISOString();
  if(Buffer.isBuffer(value))return value;
  if (Array.isArray(value)) return value.map(v=>redactOrderData(v,false));
  const sensitive = /margin|netback|gross_profit/;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!sensitive.test(key)).map(([key,v])=>[key,redactOrderData(v,false)]));
}
function allowed(a, stage) {
  return a.update&&(a.admin || a.manager || (a.team && stage !== '3A') || (a.sales && ['1','2','3'].includes(stage)) || (a.accounts && ['3A','11','12','14'].includes(stage)));
}
function project(flow, a) {
  const result = structuredClone(flow);
  if (!a.margin) {
    delete result.data.margin_per_kg;
  }
  return redactOrderData(result,a.margin);
}
async function snapshot(run, id, user) {
  const flow = (await run('SELECT * FROM order_flows WHERE transaction_id=$1', [id])).rows[0];
  if (!flow) return null;
  const a = await access(user, run);
  const logs = (await run('SELECT l.id,l.stage,l.action,l.actor,l.fields,u.name actor_name,l.created_at FROM order_flow_logs l LEFT JOIN users u ON u.id=l.actor WHERE transaction_id=$1 ORDER BY l.id DESC', [id])).rows;
  const drafts = (await run('SELECT stage,fields FROM order_flow_drafts WHERE transaction_id=$1 AND actor=$2', [id,user.id])).rows;
  const tasks=(await run('SELECT kind,assigned_role,due_date,status FROM order_flow_tasks WHERE transaction_id=$1 ORDER BY due_date,id',[id])).rows;
  return { ...project(flow,a), tasks, timeline: redactOrderData(logs,a.margin), drafts: drafts.filter(d=>allowed(a,d.stage)), permissions: { ...a, stages: stages.filter(s=>allowed(a,s.id)).map(s=>s.id) } };
}
async function pricing(run, id, quantity) {
  const lines = (await run('SELECT * FROM sales_transaction_products WHERE transaction_id=$1 ORDER BY id', [id])).rows;
  if (lines.length !== 1) fail('Flow enrollment currently requires one material/grade line; keep multi-line legacy orders in the existing workflow.',409);
  const p = lines[0];
  if(quantity!==undefined)p.quantity_kg=quantity;
  const master = (await run(`SELECT rate_per_kg FROM ex_cresco_prices WHERE lower(trim(product_category))=lower(trim($1)) AND lower(trim(grade))=lower(trim($2)) AND is_active AND valid_from<=CURRENT_DATE AND(valid_to IS NULL OR valid_to>=CURRENT_DATE) ORDER BY valid_from DESC,created_at DESC,id DESC LIMIT 1`, [p.product_category,p.grade])).rows[0];
  const freight = (await run(`SELECT base_freight_per_kg FROM logistics_base_freight WHERE from_district_id=$1 AND to_district_id=$2 AND quantity_kg=$3 AND is_active AND effective_from<=CURRENT_DATE AND(effective_to IS NULL OR effective_to>=CURRENT_DATE) ORDER BY effective_from DESC,version DESC,created_at DESC LIMIT 1`, [p.from_district_id,p.to_district_id,p.quantity_kg])).rows[0];
  return { quantity_kg: +p.quantity_kg, delivered_price: deliveredPrice(master?.rate_per_kg,freight?.base_freight_per_kg), master_price: +master.rate_per_kg, route_freight: +freight.base_freight_per_kg, material: p.product_category, grade:p.grade, from_district_id:p.from_district_id,to_district_id:p.to_district_id };
}
async function checkCredit(run, flow, a, fields, actor) {
  // Lock all workflow credit decisions for this buyer without modifying Buyer records.
  await run('SELECT pg_advisory_xact_lock($1::bigint)', [flow.buyer_id]);
  const buyer = (await run('SELECT credit_limit FROM buyers WHERE id=$1', [flow.buyer_id])).rows[0];
  const outstanding = +(await run('SELECT COALESCE(sum(outstanding),0) value FROM finance_receivables_view WHERE buyer_id=$1', [flow.buyer_id])).rows[0].value;
  const open = +(await run(`SELECT COALESCE(sum(COALESCE((f.data->'buyer_invoice'->>'total')::numeric,(f.data->>'order_value')::numeric)),0) value FROM order_flows f WHERE f.buyer_id=$1 AND f.transaction_id<>$2 AND f.status NOT IN ('Cancelled') AND f.data->>'credit_reserved'='true' AND NOT EXISTS(SELECT 1 FROM finance_receivables_view r WHERE r.buyer_id=f.buyer_id AND r.invoice_number=f.data->'buyer_invoice'->>'number')`, [flow.buyer_id,flow.transaction_id])).rows[0].value;
  // Include legacy open orders, excluding converted flow transactions to avoid double counting.
  const legacy = +(await run(`SELECT COALESCE(sum(GREATEST(COALESCE(o.total_order_value,0)-COALESCE(o.payment_received,0),0)),0) value FROM orders o WHERE o.buyer_id=$1 AND o.deleted_at IS NULL AND o.invoice_number IS NULL AND lower(o.status) NOT IN ('cancelled','closed','lost') AND NOT EXISTS(SELECT 1 FROM order_flows f WHERE f.transaction_id=o.transaction_id)`, [flow.buyer_id])).rows[0].value;
  const result = creditResult(+buyer.credit_limit,outstanding,open+legacy,flow.data.order_value);
  if (!result.passed && fields.override_reason) { if (!a.admin) fail('Only admins may override credit.',403); result.overridden = true; result.passed = true; }
  await run('INSERT INTO order_flow_credit_checks(transaction_id,result,actor,override_reason) VALUES($1,$2,$3,$4)', [flow.transaction_id,result,actor,fields.override_reason||null]);
  return result;
}
async function invalidateAfter(run,flow,stage) {
  const index=stages.findIndex(s=>s.id===stage),d=flow.data,id=flow.transaction_id;
  for(const s of stages.slice(index+1))delete d[s.id];
  const derived={ '1':['order_value'], '3A':['credit_check','credit_reserved'], '4':['supplier_rate','margin_per_kg'], '5':['actual_freight'], '6':['expected_delivery','delivery_at_risk'], '7':[], '8':['vehicle_late'], '10':['loaded_quantity'], '11':['invoice_mismatch'], '12':['buyer_invoice'], '14':['claim_required','payment_follow_up'] };
  for(const [s,keys]of Object.entries(derived))if(stages.findIndex(x=>x.id===s)>index)for(const key of keys)delete d[key];
  if(index<stages.findIndex(s=>s.id==='4'))await run('DELETE FROM order_flow_suppliers WHERE transaction_id=$1',[id]);
  if(index<stages.findIndex(s=>s.id==='7'))await run('DELETE FROM order_flow_vehicles WHERE transaction_id=$1',[id]);
  if(index<stages.findIndex(s=>s.id==='11'))await run('DELETE FROM order_flow_invoices WHERE transaction_id=$1',[id]);
  else if(index<stages.findIndex(s=>s.id==='12'))await run("DELETE FROM order_flow_invoices WHERE transaction_id=$1 AND type='buyer'",[id]);
  await run("DELETE FROM order_flow_tasks WHERE transaction_id=$1 AND kind IN('Payment follow-up','Shortage or damage claim')",[id]);
  if(index<stages.findIndex(s=>s.id==='2'))await run("DELETE FROM order_flow_tasks WHERE transaction_id=$1 AND status IN('Pending','Failed') AND kind IN('Email quotation','Share quotation on WhatsApp','Quotation follow-up')",[id]);
  if(index<stages.findIndex(s=>s.id==='12'))await run("DELETE FROM order_flow_tasks WHERE transaction_id=$1 AND status IN('Pending','Failed') AND kind='Send buyer dispatch notification'",[id]);
  flow.status='Open';
}

export function createOrderFlowService({ query, getClient }) { return {
  async quotation(id) {
    const f=(await query('SELECT * FROM order_flows WHERE transaction_id=$1',[id])).rows[0];
    if(!f?.data['2'])fail('Save quotation details first.',409);
    const buyer=(await query('SELECT group_name,gst_slab FROM buyers WHERE id=$1',[f.buyer_id])).rows[0];
    const d=f.data;
    const quoted=d.quotation_snapshot||d;
    const bank=(await query("SELECT a.account_name,a.account_number,a.branch_name,a.ifsc_code,b.bank_name FROM procurement_bank_accounts a JOIN procurement_banks b ON b.id=a.bank_id WHERE a.is_primary AND a.status='Active' AND b.status='Active' LIMIT 1")).rows[0];
    if(!bank)fail('Configure the primary bank account before generating the quotation.');
    return {number:d.quotation_number,stored:false,html:proformaInvoiceHtml({document_number:d.quotation_number,buyer_name:buyer.group_name,buyer_gst:d['3']?.gst_number,gst_slab:String(d['3']?.gst_percent??buyer.gst_slab??18),payment_terms:d['2'].payment_terms,bank_account:bank,products:[{product_category:d.material,grade:d.grade,quantity_kg:quoted.quantity_kg,quoted_price:quoted.delivered_price}]},'quotation')};
  },
  async suppliers(id) {
    return (await query(`SELECT s.id,s.group_name,w.warehouse_name,w.address,w.primary_contact,w.contact_details,p.purchase_price rate
      FROM sales_transaction_products line JOIN supplier_product_categories c ON lower(trim(c.name))=lower(trim(line.product_category))
      JOIN supplier_grades g ON g.category_id=c.id AND lower(trim(g.name))=lower(trim(line.grade))
      JOIN supplier_warehouses w ON w.id=c.warehouse_id JOIN suppliers s ON s.id=w.supplier_id AND s.is_active
      JOIN logistics_districts d ON d.id=line.to_district_id
      JOIN LATERAL(SELECT purchase_price FROM supplier_grade_prices WHERE grade_id=g.id AND is_active AND effective_at<=now() AND expires_at>now() ORDER BY effective_at DESC,created_at DESC LIMIT 1)p ON true
      WHERE line.transaction_id=$1 ORDER BY (lower(COALESCE(w.dispatch_location,''))=lower(d.name)) DESC,p.purchase_price,s.id LIMIT 3`,[id])).rows;
  },
  async list(params) {
    return (await query(`SELECT f.transaction_id,f.order_no,f.current_stage,f.status,b.group_name buyer_name,
      f.data->>'material' material,f.data->>'quantity_kg' quantity_kg,
      floor(extract(epoch FROM now()-f.stage_entered_at)/86400) days_in_stage,
      f.data->>'expected_delivery' expected_delivery,
      (f.data->>'delivery_at_risk'='true' OR f.data->>'vehicle_late'='true' OR
       now()-f.stage_entered_at>(SELECT value FROM order_flow_settings WHERE key='stuck_days')*interval '1 day') delayed
      FROM order_flows f JOIN buyers b ON b.id=f.buyer_id
      WHERE ($1::text IS NULL OR f.current_stage=$1) AND ($2::text IS NULL OR b.group_name ILIKE '%'||$2||'%')
      AND ($3::bigint IS NULL OR EXISTS(SELECT 1 FROM order_flow_suppliers s WHERE s.transaction_id=f.transaction_id AND s.supplier_id=$3))
      AND ($4::boolean=false OR f.data->>'delivery_at_risk'='true' OR f.data->>'vehicle_late'='true' OR now()-f.stage_entered_at>(SELECT value FROM order_flow_settings WHERE key='stuck_days')*interval '1 day')
      AND ($5::boolean=false OR f.data->'6'->>'dispatch_date'=CURRENT_DATE::text OR EXISTS(SELECT 1 FROM order_flow_vehicles v WHERE v.transaction_id=f.transaction_id AND v.data->>'dispatch_date'=CURRENT_DATE::text))
      ORDER BY f.updated_at DESC LIMIT 200`,[params.stage||null,params.buyer||null,params.supplier||null,params.delayed==='true',params.today==='true'])).rows;
  },
  async metadata(user) { return { stages, nestedSchemas, permissions: await access(user,query) }; },
  async get(id,user) { return snapshot(query,id,user); },
  async save(id, payload, user) {
    const { stage, action = 'advance', fields = {}, version, request_key, reason } = payload;
    if (!['enroll','advance','draft','edit','back','skip','cancel'].includes(action)) fail('Invalid action.');
    if (!Number.isInteger(version) || typeof request_key !== 'string' || !/^[\w-]{16,100}$/.test(request_key)) fail('Version and idempotency key are required.');
    const client = await getClient(); const run = (sql,args) => client.query(sql,args);
    try {
      await run('BEGIN');
      const a = await access(user,run);
      if(!a.update)fail('Order update permission required.',403);
      if (action === 'enroll') {
        if (!a.manager && !a.team) fail('Order team or manager required.',403);
        await run('SELECT id FROM sales_transactions WHERE id=$1 FOR UPDATE',[id]);
        const initial=await pricing(run,id);
        const known=(await run(`SELECT c.name contact,c.mobile_number phone,l.address delivery_address,l.gst_number,l.address billing_address FROM sales_transactions t LEFT JOIN LATERAL(SELECT name,mobile_number FROM buyer_contacts WHERE buyer_id=t.buyer_id ORDER BY is_primary DESC,id LIMIT 1)c ON true LEFT JOIN LATERAL(SELECT address,gst_number FROM buyer_locations WHERE buyer_id=t.buyer_id ORDER BY (id=(SELECT NULLIF(to_jsonb(p)->>'buyer_location_id','')::bigint FROM sales_transaction_products p WHERE p.transaction_id=t.id ORDER BY p.id LIMIT 1)) DESC NULLS LAST,id LIMIT 1)l ON true WHERE t.id=$1`,[id])).rows[0];
        initial.buyer_defaults=Object.fromEntries(Object.entries(known||{}).filter(([,v])=>v!=null));
        if ((await run('SELECT 1 FROM orders WHERE transaction_id=$1 AND deleted_at IS NULL LIMIT 1',[id])).rowCount) fail('Existing converted orders remain in the legacy workflow; enroll an unconverted enquiry.',409);
        await run(`INSERT INTO order_flows(transaction_id,order_no,buyer_id,data,legacy_stage,legacy_status) SELECT id,inquiry_number,buyer_id,$2,current_stage,status FROM sales_transactions WHERE id=$1 AND deleted_at IS NULL ON CONFLICT DO NOTHING`,[id,initial]);
      }
      const flow = (await run('SELECT * FROM order_flows WHERE transaction_id=$1 FOR UPDATE',[id])).rows[0];
      if (!flow) fail('Order flow not found.',404);
      const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const previous = (await run('SELECT * FROM order_flow_requests WHERE transaction_id=$1 AND request_key=$2',[id,request_key])).rows[0];
      if (previous) {
        if (previous.actor !== user.id || previous.fingerprint !== fingerprint) fail('Idempotency key reused with different input.',409);
        await run('COMMIT'); return project(previous.response,a);
      }
      if (flow.version !== version) fail('Order changed. Refresh before saving.',409);
      if (action === 'enroll' && flow.version !== 0) fail('Flow already enrolled.',409);
      if (['Cancelled','Delivered'].includes(flow.status)) fail('Order is closed.',409);
      if (action !== 'enroll' && !allowed(a,stage)) fail('Role cannot save this stage.',403);
      let clean = {};
      if (action === 'cancel') {
        if (!a.manager || !reason?.trim()) fail('Manager and cancellation reason required.',403);
        if (stages.findIndex(s=>s.id===flow.current_stage) >= stages.findIndex(s=>s.id==='10')) fail('Loaded orders require shortage/return closure.');
        flow.status = 'Cancelled';
      } else if (action === 'draft') {
        schemaFor(stage);
        clean = validate(schemaFor(stage).fields,fields,true);
        await run(`INSERT INTO order_flow_drafts(transaction_id,stage,actor,fields) VALUES($1,$2,$3,$4) ON CONFLICT(transaction_id,stage,actor) DO UPDATE SET fields=EXCLUDED.fields,updated_at=now()`,[id,stage,user.id,clean]);
      } else if (action !== 'enroll') {
        transition(flow.current_stage,stage,action,a.admin,a.manager,reason);
        if (action === 'back' || action === 'skip') {
          flow.current_stage = stage;
          // A rewind invalidates later data; retained audit records remain immutable.
          if (action === 'back') {
            await invalidateAfter(run,flow,stage);
          }
        } else {
          clean = validate(schemaFor(stage).fields,fields);
          const d = flow.data;
          if(action==='edit' && stage!==flow.current_stage) {
            await invalidateAfter(run,flow,stage);
          }
          if (stage === '1') {
            Object.assign(d, await pricing(run,id));
            if(clean.delivered_price && clean.delivered_price!==d.delivered_price) {
              if(!clean.price_reason)fail('Price override requires a reason.');
              await run('INSERT INTO order_flow_price_overrides(transaction_id,old_price,new_price,reason,actor) VALUES($1,$2,$3,$4,$5)',[id,d.delivered_price,clean.delivered_price,clean.price_reason,user.id]);
              d.delivered_price=clean.delivered_price;
            }
          }
          if (stage === '2') d.payment_terms = clean.payment_terms;
          if (stage === '2') d.quotation_number=`QUO-${flow.order_no}`;
          if (stage === '2') d.quotation_snapshot={quantity_kg:d.quantity_kg,delivered_price:d.delivered_price};
          if (stage === '2') await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role,due_date) VALUES($1,'Quotation follow-up','Sales',$2::date-1) ON CONFLICT(transaction_id,kind) DO UPDATE SET due_date=EXCLUDED.due_date,status='Pending',attempts=0`,[id,clean.validity]);
          if (stage === '2'&&clean.send_via==='Email') await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role) VALUES($1,'Email quotation','Sales') ON CONFLICT(transaction_id,kind) DO UPDATE SET status='Pending',attempts=0`,[id]);
          if (stage === '2'&&clean.send_via==='WhatsApp') await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role) VALUES($1,'Share quotation on WhatsApp','Sales') ON CONFLICT(transaction_id,kind) DO NOTHING`,[id]);
          if (stage === '1') d.payment_terms = clean.payment_terms;
          if (stage === '3') {
            await run("UPDATE order_flow_tasks SET status='Completed' WHERE transaction_id=$1 AND kind='Quotation follow-up'",[id]);
            if(clean.quantity_kg!==d.quantity_kg)d.route_freight=(await pricing(run,id,clean.quantity_kg)).route_freight;
            if (flow.data['3'] && !a.manager && (clean.delivered_price !== d.delivered_price || clean.quantity_kg !== d.quantity_kg)) fail('Manager required to change locked price/quantity.',403);
            if (clean.delivered_price !== d.delivered_price) {
              if (!clean.price_reason) fail('Price override requires a reason.');
              await run('INSERT INTO order_flow_price_overrides(transaction_id,old_price,new_price,reason,actor) VALUES($1,$2,$3,$4,$5)',[id,d.delivered_price,clean.delivered_price,clean.price_reason,user.id]);
            }
            if (clean.gst_percent>100 || !Number.isInteger(clean.credit_days) || clean.credit_days>366) fail('Invalid GST or credit days.');
            d.quantity_kg=clean.quantity_kg; d.delivered_price=clean.delivered_price;
            d.order_value=Math.round(d.quantity_kg*d.delivered_price*(1+clean.gst_percent/100)*100)/100;
            d.credit_reserved=false;
          }
          if (stage === '3A') {
            if (d.payment_terms === 'Advance') {
              if (!clean.amount || !clean.payment_date || !clean.mode || !clean.bank_reference || clean.amount>d.order_value) fail('Enter positive part payment, date, mode and bank reference.');
              d.credit_check={passed:true,advance:true};
            } else d.credit_check=await checkCredit(run,flow,a,clean,user.id);
            d.credit_reserved=d.credit_check.passed;
            if (!d.credit_check.passed) flow.status='Credit check failed'; else flow.status='Open';
          }
          if (stage === '4') {
            if (!d.credit_check?.passed) fail('Payment or credit check must pass.',409);
            if (Math.abs(clean.suppliers.reduce((n,s)=>n+s.quantity_kg,0)-d.quantity_kg)>0.001) fail('Supplier allocations must equal ordered kg.');
            await run('DELETE FROM order_flow_suppliers WHERE transaction_id=$1',[id]);
            for (const s of clean.suppliers) {
              if (!(await run('SELECT id FROM suppliers WHERE id=$1 AND is_active',[s.supplier_id])).rowCount) fail('Select an active supplier.');
              await run('INSERT INTO order_flow_suppliers(transaction_id,supplier_id,data) VALUES($1,$2,$3)',[id,s.supplier_id,s]);
            }
            d.supplier_rate=clean.suppliers.reduce((n,s)=>n+s.quantity_kg*s.rate,0)/d.quantity_kg;
          }
          if (stage === '5') {
            d.freight_paid_by='Cresco';
            if (!(await run('SELECT id FROM logistics_transporters WHERE id=$1 AND is_active',[clean.transporter_id])).rowCount) fail('Select an active transporter.');
            d.actual_freight=clean.freight_basis==='Per trip'?clean.freight/d.quantity_kg:clean.freight;
            if (d.actual_freight>d.route_freight&&!clean.freight_reason) fail('Freight above route master requires a reason.');
          }
          if (stage === '6') {
            d.expected_delivery=new Date(Date.parse(clean.dispatch_date)+clean.transit_days*86400000).toISOString().slice(0,10);
            d.delivery_at_risk=!!d['1']?.required_delivery && d.expected_delivery>d['1'].required_delivery;
          }
          const settings = Object.fromEntries((await run('SELECT key,value FROM order_flow_settings')).rows.map(s=>[s.key,+s.value]));
          if (stage === '7') {
            capacity(clean.vehicles,d.quantity_kg,d.quantity_kg*settings.packing_volume_m3_per_kg);
            for(const v of clean.vehicles) {
              const supplier=d['4']?.suppliers.find(s=>s.supplier_id===v.supplier_id);
              if(!supplier)fail('Assign every vehicle to a confirmed supplier.');
              if(v.dispatch_date<supplier.ready_date)fail('Vehicle dispatch cannot precede supplier ready date.');
            }
            for(const s of d['4']?.suppliers||[])if(Math.abs(clean.vehicles.filter(v=>v.supplier_id===s.supplier_id).reduce((n,v)=>n+v.allocated_kg,0)-s.quantity_kg)>0.001)fail('Vehicle allocations must match each supplier allocation.');
            await run('DELETE FROM order_flow_vehicles WHERE transaction_id=$1',[id]);
            for(const v of clean.vehicles) await run('INSERT INTO order_flow_vehicles(transaction_id,data) VALUES($1,$2)',[id,v]);
          }
          if (stage === '8') d.vehicle_late=Date.parse(clean.arrival)>Date.parse(d['6']?.dispatch_date)+86400000;
          if (stage === '9' && Date.parse(clean.loading_start)<Date.parse(d['8']?.arrival)) fail('Loading cannot start before arrival.');
          if (stage === '10') {
            if (Date.parse(clean.loading_end)<Date.parse(d['9']?.loading_start)) fail('Loading cannot end before starting.');
            if (Math.abs(clean.loaded_quantity-d.quantity_kg)/d.quantity_kg*100>settings.quantity_tolerance_percent&&!clean.quantity_reason) fail('Quantity variance exceeds tolerance; enter a reason.');
            d.loaded_quantity=clean.loaded_quantity;
          }
          if (stage === '11') {
            await run("DELETE FROM order_flow_invoices WHERE transaction_id=$1 AND type='supplier'",[id]);
            d.invoice_mismatch=false;
            for(const supplier of d['4']?.suppliers||[]) {
              const invoiced=clean.invoices.filter(i=>i.supplier_id===supplier.supplier_id).reduce((n,i)=>n+i.quantity_kg,0);
              if(Math.abs(invoiced-supplier.quantity_kg)>0.001) {
                if(!clean.mismatch_reason)fail('Supplier invoice quantity differs from PO; enter a mismatch reason.');
                d.invoice_mismatch=true;
              }
            }
            for(const i of clean.invoices) {
              const supplier=d['4']?.suppliers.find(s=>s.supplier_id===i.supplier_id);
              if(!supplier)fail('Invoice supplier must be a confirmed supplier.');
              const mismatch=!supplier||Math.abs(supplier.rate-i.rate)>0.0001||Math.abs(i.taxable-i.quantity_kg*i.rate)>0.01||Math.abs(i.total-i.taxable-i.gst)>0.01;
              if(mismatch&&!clean.mismatch_reason) fail('Supplier invoice differs from PO; enter a mismatch reason.');
              d.invoice_mismatch ||= mismatch;
              await run("INSERT INTO order_flow_invoices(transaction_id,type,number,data) VALUES($1,'supplier',$2,$3)",[id,i.number,i]);
            }
          }
          if (stage === '12') {
            if (!d.loaded_quantity) fail('Loaded quantity is required for buyer invoicing.');
            const taxable=Math.round(d.loaded_quantity*d.delivered_price*100)/100;
            const invoice={quantity_kg:d.loaded_quantity,taxable,gst:Math.round(taxable*d['3'].gst_percent)/100,date:clean.invoice_date};
            invoice.total=invoice.taxable+invoice.gst;
            d.buyer_invoice={number:`INV-${flow.order_no}`, ...invoice};
            await run("INSERT INTO order_flow_invoices(transaction_id,type,number,data) VALUES($1,'buyer',$2,$3) ON CONFLICT(transaction_id,type,number) DO UPDATE SET data=EXCLUDED.data",[id,d.buyer_invoice.number,invoice]);
            if(clean.notify_buyer==='Yes')await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role,details) VALUES($1,'Send buyer dispatch notification','Sales',$2) ON CONFLICT(transaction_id,kind) DO UPDATE SET details=EXCLUDED.details`,[id,{invoice:d.buyer_invoice.number,lr_number:clean.lr_number}]);
          }
          if (stage === '13' && !d.buyer_invoice) fail('Create buyer invoice before transit.');
          if (stage === '14') {
            if (clean.received_quantity!==d.loaded_quantity&&!clean.shortage_damage_reason) fail('Quantity difference requires shortage/damage reason.');
            d.claim_required=!!clean.shortage_damage_reason; d.payment_follow_up=true; flow.status='Delivered';
            await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role,details) VALUES($1,'Payment follow-up','Accounts',$2) ON CONFLICT(transaction_id,kind) DO UPDATE SET details=EXCLUDED.details`,[id,{invoice:d.buyer_invoice}]);
            if(d.claim_required)await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role,details) VALUES($1,'Shortage or damage claim','Accounts',$2) ON CONFLICT(transaction_id,kind) DO UPDATE SET details=EXCLUDED.details`,[id,clean]);
          }
          d[stage]=clean;
          if (stage!=='3A'||d.credit_check.passed) flow.current_stage=stage;
          if (stage==='3'&&d.payment_terms==='Advance') flow.status='Awaiting advance';
          if (stage==='3'&&d.payment_terms!=='Advance') {
            d.credit_check=await checkCredit(run,flow,a,{},user.id);
            d.credit_reserved=d.credit_check.passed;
            if(d.credit_check.passed) flow.current_stage='3A';
            else flow.status='Credit check failed';
          }
          if (d.supplier_rate!=null) d.margin_per_kg=d.delivered_price-d.supplier_rate-(d.actual_freight??d.route_freight);
          for(const [flag,kind]of [['delivery_at_risk','Delivery date at risk'],['vehicle_late','Vehicle late at godown'],['invoice_mismatch','Supplier invoice mismatch']]) {
            if(d[flag])await run(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role) VALUES($1,$2,'Manager') ON CONFLICT(transaction_id,kind) DO NOTHING`,[id,kind]);
          }
          await run('DELETE FROM order_flow_drafts WHERE transaction_id=$1 AND stage=$2 AND actor=$3',[id,stage,user.id]);
        }
      }
      await run('UPDATE order_flows SET stage_entered_at=CASE WHEN current_stage<>$2 THEN now() ELSE stage_entered_at END,current_stage=$2,status=$3,data=$4,version=version+1,updated_at=now() WHERE transaction_id=$1',[id,flow.current_stage,flow.status,flow.data]);
      await run("SELECT set_config('cresco.order_flow_write','on',true)");
      await run('UPDATE sales_transactions SET current_stage=$2,status=$3,updated_at=now() WHERE id=$1',[id,stages.find(s=>s.id===flow.current_stage)?.name||'Inquiry Created',flow.status]);
      await run('INSERT INTO order_flow_logs(transaction_id,stage,action,fields,actor) VALUES($1,$2,$3,$4,$5)',[id,stage||'0',action,{fields:clean,reason:reason||null},user.id]);
      // Store a complete snapshot internally; project permissions on every replay.
      const raw=(await run('SELECT * FROM order_flows WHERE transaction_id=$1',[id])).rows[0];
      await run('INSERT INTO order_flow_requests(transaction_id,request_key,actor,fingerprint,response) VALUES($1,$2,$3,$4,$5)',[id,request_key,user.id,fingerprint,raw]);
      await run('COMMIT');
      return project(raw,a);
    } catch(error) { await run('ROLLBACK'); throw error; } finally { client.release(); }
  },
}; }
export const OrderFlowService = createOrderFlowService({query:dbQuery,getClient:dbGetClient});
