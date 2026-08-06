import { query } from "../db.js";
const maps = {
  orders: ["order_number","buyer_id","supplier_id","logistics_lane_id","product_category","grade","quantity_kg","sale_price_per_kg","purchase_price_per_kg","freight_per_kg","status","order_date","expected_delivery_date","remarks"],
  finance: ["reference_no","buyer_id","supplier_id","logistics_cost_id","freight_per_kg","amount","type","due_date","payment_status","remarks"]
};
export const ResourcesService = {
  async list(table) { return (await query(`SELECT * FROM ${table} ORDER BY id DESC`)).rows; },
  async create(table, body) { const keys = maps[table]; const present = keys.filter((key) => body[key] !== undefined); const values = present.map((key) => body[key]); const marks = present.map((_, i) => `$${i + 1}`); return (await query(`INSERT INTO ${table} (${present.join(",")}) VALUES (${marks.join(",")}) RETURNING *`, values)).rows[0]; },
  async update(table, id, body) { const keys = maps[table].filter((key) => body[key] !== undefined); const values = keys.map((key) => body[key]); values.push(id); return (await query(`UPDATE ${table} SET ${keys.map((key,i)=>`${key}=$${i+1}`).join(",")} WHERE id=$${values.length} RETURNING *`, values)).rows[0]; },
  async remove(table, id) { await query(`DELETE FROM ${table} WHERE id=$1`, [id]); return { message: "Record removed." }; },
};
