import { query } from "../db.js";
import { safeJson } from "../utils.js";

export const EnquiriesService = {
  async list() {
    const result = await query(
      `SELECT e.*, b.group_name AS buyer_name, s.group_name AS supplier_name, u.name AS assigned_user
       FROM enquiries e
       LEFT JOIN buyers b ON b.id = e.buyer_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.assigned_user
       ORDER BY e.created_at DESC`
    );
    return result.rows.map((row) => safeJson(row));
  },

  async get(id) {
    const result = await query(
      `SELECT e.*, b.group_name AS buyer_name, s.group_name AS supplier_name, u.name AS assigned_user
       FROM enquiries e
       LEFT JOIN buyers b ON b.id = e.buyer_id
       LEFT JOIN suppliers s ON s.id = e.supplier_id
       LEFT JOIN users u ON u.id = e.assigned_user
       WHERE e.id = $1`,
      [id]
    );
    return safeJson(result.rows[0]) || null;
  },

  async create(payload) {
    const enquiryNo = `ENQ-${Date.now()}`;
    const result = await query(
      `INSERT INTO enquiries (enquiry_no, buyer_id, supplier_id, chemical, quantity, unit, price, currency, status, priority, notes, expected_closing_date, assigned_user)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        enquiryNo,
        payload.buyer_id,
        payload.supplier_id,
        payload.chemical,
        payload.quantity,
        payload.unit || "MT",
        payload.price,
        payload.currency || "INR",
        payload.status || "New",
        payload.priority || "Normal",
        payload.notes,
        payload.expected_closing_date,
        payload.assigned_user,
      ]
    );
    return safeJson(result.rows[0]);
  },

  async update(id, payload) {
    const fields = [];
    const values = [];
    let index = 1;
    const keys = [
      "buyer_id",
      "supplier_id",
      "chemical",
      "quantity",
      "unit",
      "price",
      "currency",
      "status",
      "priority",
      "notes",
      "expected_closing_date",
      "assigned_user",
    ];
    for (const key of keys) {
      if (payload[key] !== undefined) {
        fields.push(`${key} = $${index++}`);
        values.push(payload[key]);
      }
    }
    if (fields.length === 0) return null;
    values.push(id);
    const result = await query(`UPDATE enquiries SET ${fields.join(", ")}, updated_at = now() WHERE id = $${index} RETURNING *`, values);
    return safeJson(result.rows[0]);
  },

  async remove(id) {
    await query("DELETE FROM enquiries WHERE id = $1", [id]);
    return { message: "Enquiry removed." };
  },
};
