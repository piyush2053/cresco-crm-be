
import { verifyToken } from "./utils.js";
import { query } from "./db.js";

export async function requiresAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication required." });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = verifyToken(token);
    const result = await query("SELECT id, email, role_id, is_admin, is_active FROM users WHERE id = $1", [payload.userId]);
    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ message: "Invalid session." });
    }
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

export function requiresAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required." });
  }
  if (!req.user.is_admin) {
    return res.status(403).json({ message: "Admin privilege required." });
  }
  next();
}

export function requiresPermission(moduleName, permissionName) {
  return async function (req, res, next) {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication required." });
    }
    const result = await query("SELECT permissions FROM roles WHERE id = $1", [req.user.role_id]);
    const role = result.rows[0];
    if (!role) {
      return res.status(403).json({ message: "Role not found." });
    }
    const granular = await query("SELECT permissions FROM settings_access_permissions WHERE role_id=$1 AND scope_type='Module' AND scope_key=$2", [req.user.role_id, moduleName]);
    if (granular.rows[0]) {
      const action = ({ read: "view", update: "edit" })[permissionName] || permissionName;
      if (granular.rows[0].permissions?.[action] !== true) return res.status(403).json({ message: "Permission denied." });
      return next();
    }
    const permissions = role.permissions || {};
    const modules = permissions.modules || {};
    const actions = permissions.actions || {};
    const moduleAllowed = modules[moduleName] === true;
    // Actions are an allow-list: absent, null and false all mean denied.
    const actionAllowed = actions[permissionName] === true;
    if (!moduleAllowed || !actionAllowed) {
      return res.status(403).json({ message: "Permission denied." });
    }
    next();
  };
}

export function requiresScopedPermission(scopeType, scopeKey, action) {
  return async function(req,res,next){
    if(!req.user)return res.status(401).json({message:"Authentication required."});
    if(req.user.is_admin)return next();
    const result=await query("SELECT permissions,conditions FROM settings_access_permissions WHERE role_id=$1 AND scope_type=$2 AND scope_key=$3",[req.user.role_id,scopeType,scopeKey]);
    if(!result.rows[0]?.permissions?.[action])return res.status(403).json({message:"Permission denied."});
    req.accessConditions=result.rows[0].conditions||{};next();
  };
}
