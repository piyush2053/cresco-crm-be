import { query } from "../db.js";
import { safeJson } from "../utils.js";

export const RolesService = {
  async list() {
    const result = await query("SELECT id, name, permissions, created_at FROM roles ORDER BY name");
    return result.rows.map((row) => safeJson(row));
  },

  async create(payload) {
    const result = await query("INSERT INTO roles (name, permissions) VALUES ($1, $2) RETURNING id, name, permissions, created_at", [payload.name, payload.permissions || {}]);
    return safeJson(result.rows[0]);
  },

  async update(id, payload) {
    const result = await query("UPDATE roles SET name = $1, permissions = $2 WHERE id = $3 RETURNING id, name, permissions, created_at", [payload.name, payload.permissions || {}, id]);
    return safeJson(result.rows[0]);
  },

  async remove(id) {
    await query("DELETE FROM roles WHERE id = $1", [id]);
    return { message: "Role removed." };
  },
};
