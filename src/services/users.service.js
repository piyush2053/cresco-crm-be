import { query, getClient } from "../db.js";
import { hashPassword, safeJson } from "../utils.js";
import { alertAdmins } from "./admin-alerts.service.js";

const mapUserFields = {
  name: "name",
  email: "email",
  roleId: "role_id",
  isAdmin: "is_admin",
  isActive: "is_active",
  emailVerified: "email_verified",
};

export const UsersService = {
  async list() {
    const result = await query(
      "SELECT id, name, email, role_id, is_admin, is_active, email_verified, last_login, created_at FROM users ORDER BY created_at DESC"
    );
    return result.rows;
  },

  async get(id) {
    const result = await query(
      "SELECT id, name, email, role_id, is_admin, is_active, email_verified, last_login, created_at FROM users WHERE id = $1",
      [id]
    );
    return result.rows[0] || null;
  },

  async create(payload) {
    const hashed = hashPassword(payload.password);
    const result = await query(
      "INSERT INTO users (name, email, password, role_id, is_admin, is_active, email_verified) VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id, name, email, role_id, is_admin, is_active, email_verified, created_at",
      [payload.name, payload.email, hashed, payload.roleId, payload.isAdmin ?? false, payload.isActive ?? true]
    );
    await alertAdmins(
      "User created by admin",
      `${payload.name} (${payload.email}) was added to the CRM.`,
      "success",
      "/settings"
    );
    return {
      status: 201,
      body: result.rows[0],
    };
  },

  async update(id, payload) {
    const client = await getClient();
    try {
      await client.query("BEGIN");

      if (payload.password) {
        const hashed = hashPassword(payload.password);
        await client.query("UPDATE users SET password = $1 WHERE id = $2", [hashed, id]);
      }

      const fields = [];
      const params = [];
      let index = 1;

      for (const key of Object.keys(mapUserFields)) {
        if (payload[key] !== undefined) {
          fields.push(`${mapUserFields[key]} = $${index}`);
          params.push(payload[key]);
          index += 1;
        }
      }

      if (fields.length > 0) {
        params.push(id);
        await client.query(`UPDATE users SET ${fields.join(", ")} WHERE id = $${index}`, params);
      }

      await client.query("COMMIT");

      const result = await query(
        "SELECT id, name, email, role_id, is_admin, is_active, email_verified, last_login, created_at FROM users WHERE id = $1",
        [id]
      );

      return {
        status: 200,
        body: result.rows[0],
      };
    } catch (error) {
      await client.query("ROLLBACK");
      return {
        status: 500,
        body: { message: "Unable to update user." },
      };
    } finally {
      client.release();
    }
  },

  async remove(id) {
    await query("DELETE FROM users WHERE id = $1", [id]);
    return {
      status: 200,
      body: { message: "User removed." },
    };
  },
};
