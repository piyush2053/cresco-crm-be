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
  async profile(id) {
    const user=(await query("SELECT u.id,u.name,u.email,u.is_admin,u.is_active,u.email_verified,u.last_login,u.created_at,r.id role_id,r.name role_name,r.description role_description,r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1",[id])).rows[0];
    if(!user)return null;
    const[access,activities,notifications]=await Promise.all([
      query("SELECT scope_type,scope_key,permissions,conditions,updated_at FROM settings_access_permissions WHERE role_id=$1 ORDER BY scope_type,scope_key",[user.role_id]),
      query(`SELECT * FROM(
        SELECT 'Buyer' source,activity_type action,description detail,occurred_at happened_at FROM buyer_activities WHERE created_by=$1
        UNION ALL SELECT 'Supplier',activity_type,description,occurred_at FROM supplier_activities WHERE created_by=$1
        UNION ALL SELECT 'Sales',communication_type,message,created_at FROM sales_communications WHERE created_by=$1
        UNION ALL SELECT 'Sales Stage','Stage Changed',concat_ws(' ',previous_stage,'→',new_stage,remarks),changed_at FROM sales_stage_history WHERE changed_by=$1
        UNION ALL SELECT 'Finance',action,concat(entity_type,' #',entity_id),occurred_at FROM finance_audit_log WHERE user_id=$1
        UNION ALL SELECT 'Settings','Configuration Changed',concat_ws(' · ',entity_type,configuration_key,reason),changed_at FROM settings_configuration_history WHERE changed_by=$1
      )activity ORDER BY happened_at DESC LIMIT 100`,[id]),
      query("SELECT id,title,message,type,link,is_read,created_at,archived_at FROM notifications WHERE user_id=$1 AND archived_at IS NOT NULL ORDER BY archived_at DESC LIMIT 200",[id])
    ]);
    return safeJson({...user,granular_access:access.rows,activities:activities.rows,notification_history:notifications.rows});
  },
  async list() {
    const result = await query(
      "SELECT u.id,u.name,u.email,u.role_id,u.is_admin,u.is_active,u.email_verified,u.last_login,u.created_at,r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id ORDER BY u.created_at DESC"
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
    try {
      const existing=await query("SELECT id FROM users WHERE lower(email)=lower($1)",[payload.email]);
      if(existing.rowCount)return{status:409,body:{message:"A user with this email address already exists."}};
      const hashed = hashPassword(payload.password);
      const result = await query(
        "INSERT INTO users (name, email, password, role_id, is_admin, is_active, email_verified) VALUES ($1, lower($2), $3, $4, $5, $6, TRUE) RETURNING id, name, email, role_id, is_admin, is_active, email_verified, created_at",
        [payload.name, payload.email, hashed, payload.roleId, payload.isAdmin ?? false, payload.isActive ?? true]
      );
      await alertAdmins("User created by admin",`${payload.name} (${payload.email}) was added to the CRM.`,"success","/settings");
      return {status:201,body:result.rows[0]};
    } catch(error) {
      if(error.code==="23505"&&error.constraint==="users_email_key")return{status:409,body:{message:"A user with this email address already exists."}};
      throw error;
    }
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
