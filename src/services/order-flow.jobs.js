import { getClient as dbGetClient } from '../db.js';
import { sendMail as dbSendMail } from '../utils.js';
import { OrderFlowService } from './order-flow.service.js';

const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Transactional outbox. SMTP delivery is at-least-once; no files are written.
export function createOrderFlowJobs({getClient,sendMail,flowService}) { return async function runOrderFlowJobs() {
  const c=await getClient();
  try {
    if(!(await c.query("SELECT to_regclass('order_flow_tasks') value")).rows[0].value)return;
    await c.query(`INSERT INTO order_flow_tasks(transaction_id,kind,assigned_role)
      SELECT transaction_id,'Order stuck at stage '||current_stage,'Manager' FROM order_flows
      WHERE status NOT IN('Cancelled','Delivered') AND now()-stage_entered_at>(SELECT value FROM order_flow_settings WHERE key='stuck_days')*interval '1 day'
      ON CONFLICT(transaction_id,kind) DO NOTHING`);
    for(let count=0;count<20;count++) {
      await c.query('BEGIN');
      const task=(await c.query("SELECT t.*,f.buyer_id,f.order_no,f.data FROM order_flow_tasks t JOIN order_flows f ON f.transaction_id=t.transaction_id WHERE t.status='Pending' AND t.due_date<=CURRENT_DATE AND t.attempts<5 AND f.status<>'Cancelled' ORDER BY t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1")).rows[0];
      if(!task){await c.query('COMMIT');break;}
      try {
        if(['Email quotation','Send buyer dispatch notification'].includes(task.kind)) {
          const recipients=(await c.query("SELECT DISTINCT email_address FROM buyer_contacts WHERE buyer_id=$1 AND email_address IS NOT NULL AND trim(email_address)<>''",[task.buyer_id])).rows.map(r=>r.email_address);
          if(!recipients.length)throw Object.assign(new Error('No buyer email.'),{code:'NO_RECIPIENT'});
          const html=task.kind==='Email quotation'?(await flowService.quotation(task.transaction_id)).html.replaceAll('{{LOGO_URL}}',''):`<p>Order ${escape(task.order_no)} dispatched. LR: ${escape(task.data['12']?.lr_number)}. Invoice: ${escape(task.data.buyer_invoice?.number)}. Vehicles: ${escape((task.data['7']?.vehicles||[]).map(v=>v.number).join(', '))}.</p>`;
          // A single message avoids partial success across several per-recipient sends.
          await sendMail(recipients.join(','),`Cresco Global: ${task.kind} · ${task.order_no}`,html);
        } else {
          await c.query(`INSERT INTO notifications(user_id,title,message,type,link,metadata)
            SELECT u.id,$1,$2,'warning',$3,$4 FROM users u LEFT JOIN roles r ON r.id=u.role_id
            WHERE u.is_active AND (u.is_admin OR lower(r.name)=lower($5))`,[task.kind,`Order ${task.order_no}: ${task.kind}.`,`/orders?transaction=${task.transaction_id}`,{order_flow_task:task.id},task.assigned_role]);
        }
        await c.query("UPDATE order_flow_tasks SET status=$2,attempts=attempts+1,last_error_code=NULL WHERE id=$1",[task.id,['Email quotation','Send buyer dispatch notification'].includes(task.kind)?'Completed':'Notified']);
      } catch(error) {
        // Do not log recipient details, bank references or SMTP responses.
        await c.query("UPDATE order_flow_tasks SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'Failed' ELSE 'Pending' END,last_error_code=$2 WHERE id=$1",[task.id,/^[A-Z_0-9]{1,40}$/.test(error.code||'')?error.code:'DELIVERY_FAILED']);
      }
      await c.query('COMMIT');
    }
  } catch(error) { await c.query('ROLLBACK');throw error; } finally { c.release(); }
}; }
export const runOrderFlowJobs=createOrderFlowJobs({getClient:dbGetClient,sendMail:dbSendMail,flowService:OrderFlowService});
