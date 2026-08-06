import { query } from "../db.js";
import { safeJson } from "../utils.js";

const BUYER_FIELDS = ["group_name", "pan", "gst_slab", "state", "group_tag", "reference", "parent_location", "remark", "lead_manager", "lead_type", "monthly_consumption", "call_date", "next_call_date", "call_remark", "profile_shared", "quote_shared", "order_status", "credit_interest"];
const CONTACT_FIELDS = ["name", "department", "designation", "mobile_number", "email_address", "whatsapp_number", "notes", "is_primary"];
const LOCATION_FIELDS = ["name", "gst_number", "pan", "address", "city", "state", "delivery_preferences", "credit_terms"];

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
      query("SELECT * FROM buyer_contacts WHERE buyer_id=$1 ORDER BY is_primary DESC, created_at", [id]),
      query("SELECT * FROM buyer_locations WHERE buyer_id=$1 ORDER BY created_at", [id]),
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
};
