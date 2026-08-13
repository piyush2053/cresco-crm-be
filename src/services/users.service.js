import { query, getClient } from "../db.js";
import { hashPassword, safeJson } from "../utils.js";
import { EmailNotificationsService } from "./email-notifications.service.js";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { sendMail } from "../utils.js";
import { config } from "../config.js";

const deletionOtpHash=(otp,targetId,requesterId)=>createHash("sha256").update(`${otp}:${targetId}:${requesterId}:${config.app.jwtSecret}`).digest("hex");
const creationOtpHash=(otp,email,requesterId)=>createHash("sha256").update(`${otp}:${String(email).toLowerCase()}:${requesterId}:${config.app.jwtSecret}`).digest("hex");
const sameHash=(a,b)=>{const left=Buffer.from(a||"","hex"),right=Buffer.from(b||"","hex");return left.length===right.length&&left.length>0&&timingSafeEqual(left,right)};

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
      "SELECT u.id,u.name,u.email,u.role_id,u.is_admin,u.is_active,u.email_verified,u.last_login,u.created_at,r.name role_name FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC"
    );
    return result.rows;
  },

  async get(id) {
    const result = await query(
      "SELECT id, name, email, role_id, is_admin, is_active, email_verified, last_login, created_at FROM users WHERE id = $1 AND deleted_at IS NULL",
      [id]
    );
    return result.rows[0] || null;
  },

  async requestCreate(payload,actorId) {
    if(!payload.name?.trim()||!payload.email?.trim()||!payload.password||!payload.roleId)return{status:400,body:{message:"Name, email, password and role are required."}};
    if(payload.password.length<8)return{status:400,body:{message:"Password must contain at least 8 characters."}};
    if((await query("SELECT 1 FROM users WHERE lower(email)=lower($1)",[payload.email])).rowCount)return{status:409,body:{message:"A user with this email address already exists."}};
    if(!(await query("SELECT 1 FROM roles WHERE id=$1",[payload.roleId])).rowCount)return{status:400,body:{message:"Select a valid role."}};
    const otp=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+config.app.otpExpiresMinutes*60*1000),email=payload.email.trim().toLowerCase();
    await query("UPDATE user_creation_challenges SET consumed_at=now() WHERE requested_by=$1 AND lower(email)=lower($2) AND consumed_at IS NULL",[actorId,email]);
    const challenge=(await query("INSERT INTO user_creation_challenges(requested_by,email,name,password_hash,role_id,is_admin,is_active,otp_hash,expires_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id",[actorId,email,payload.name.trim(),hashPassword(payload.password),payload.roleId,payload.isAdmin===true,payload.isActive!==false,creationOtpHash(otp,email,actorId),expiresAt])).rows[0];
    try{await sendMail(email,"Approve your Cresco CRM account",`<p>Hello ${payload.name.trim()},</p><p>An administrator wants to add you to Cresco CRM.</p><p>Your account approval OTP is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>Share this OTP with the administrator only if you approve account creation. It expires in ${config.app.otpExpiresMinutes} minutes.</p>`)}catch(error){await query("UPDATE user_creation_challenges SET consumed_at=now() WHERE id=$1",[challenge.id]);throw error}
    return{status:200,body:{challengeId:challenge.id,otpRequired:true,message:`OTP sent to ${email}. Enter it to create the user.`,expiresInMinutes:config.app.otpExpiresMinutes}};
  },
  async confirmCreate(payload,actorId) {
    const client=await getClient();
    try{await client.query("BEGIN");const challenge=(await client.query("SELECT * FROM user_creation_challenges WHERE id=$1 AND requested_by=$2 AND consumed_at IS NULL FOR UPDATE",[payload.challengeId,actorId])).rows[0];if(!challenge||new Date(challenge.expires_at)<=new Date()){await client.query("ROLLBACK");return{status:400,body:{message:"Creation OTP is missing or expired. Start again."}}}if(challenge.attempts>=5){await client.query("ROLLBACK");return{status:429,body:{message:"Too many invalid OTP attempts. Start again."}}}if(!sameHash(creationOtpHash(String(payload.otp||""),challenge.email,actorId),challenge.otp_hash)){await client.query("UPDATE user_creation_challenges SET attempts=attempts+1 WHERE id=$1",[challenge.id]);await client.query("COMMIT");return{status:400,body:{message:"Invalid account creation OTP."}}}if((await client.query("SELECT 1 FROM users WHERE lower(email)=lower($1)",[challenge.email])).rowCount){await client.query("UPDATE user_creation_challenges SET consumed_at=now() WHERE id=$1",[challenge.id]);await client.query("COMMIT");return{status:409,body:{message:"A user with this email address already exists."}}}const user=(await client.query("INSERT INTO users(name,email,password,role_id,is_admin,is_active,email_verified)VALUES($1,$2,$3,$4,$5,$6,TRUE)RETURNING id,name,email,role_id,is_admin,is_active,email_verified,created_at",[challenge.name,challenge.email,challenge.password_hash,challenge.role_id,challenge.is_admin,challenge.is_active])).rows[0];await client.query("UPDATE user_creation_challenges SET consumed_at=now() WHERE id=$1",[challenge.id]);await client.query("COMMIT");await EmailNotificationsService.dispatch("user_created",{title:"User created by admin",message:`${user.name} (${user.email}) was added to the CRM after email OTP approval.`,type:"success",link:"/settings",subject:"Cresco CRM account created",html:`<p>${user.name} (${user.email}) was added to the CRM after email approval.</p>`});return{status:201,body:{user,message:`${user.name} was created successfully.`}}}catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
  },

  async update(id, payload, actorId) {
    const client = await getClient();
    try {
      await client.query("BEGIN");

      const current=(await client.query("SELECT id,name,email,is_admin FROM users WHERE id=$1 AND deleted_at IS NULL",[id])).rows[0];
      if(!current){await client.query("ROLLBACK");return{status:404,body:{message:"User not found."}}}
      if(id===actorId&&payload.isAdmin===false){await client.query("ROLLBACK");return{status:400,body:{message:"You cannot remove your own administrator access."}}}
      if(current.is_admin&&payload.isAdmin===false){const count=+(await client.query("SELECT count(*) FROM users WHERE is_admin AND is_active AND deleted_at IS NULL")).rows[0].count;if(count<=1){await client.query("ROLLBACK");return{status:409,body:{message:"The last active administrator cannot be demoted."}}}}

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

      let verificationOtp=null;
      if(payload.email&&payload.email.toLowerCase()!==current.email.toLowerCase()){
        verificationOtp=String(randomInt(100000,1000000));
        await client.query("UPDATE users SET email_verified=FALSE,otp_code=$1,otp_expires_at=$2,refresh_token=NULL WHERE id=$3",[verificationOtp,new Date(Date.now()+config.app.otpExpiresMinutes*60*1000),id]);
      }

      await client.query("COMMIT");

      if(verificationOtp)await sendMail(payload.email,"Verify your updated Cresco CRM email",`<p>Hello ${payload.name||current.name},</p><p>Your email verification OTP is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${verificationOtp}</p><p>It expires in ${config.app.otpExpiresMinutes} minutes. Your CRM login remains blocked until this email is verified.</p>`);

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

  async requestRemoval(id, actorId) {
    if(id===actorId)return{status:400,body:{message:"You cannot delete your own account."}};
    const target=(await query("SELECT id,name,email,is_admin,is_active,email_verified FROM users WHERE id=$1 AND deleted_at IS NULL",[id])).rows[0];
    if(!target)return{status:404,body:{message:"User not found."}};
    if(!target.is_admin)return{status:200,body:{otpRequired:false,message:"This user can be deleted without OTP."}};
    const activeAdmins=+(await query("SELECT count(*) FROM users WHERE is_admin AND is_active AND deleted_at IS NULL")).rows[0].count;
    if(activeAdmins<=1)return{status:409,body:{message:"The last active administrator cannot be deleted."}};
    const otp=String(randomInt(100000,1000000)),expiresAt=new Date(Date.now()+10*60*1000);
    await query("UPDATE user_deletion_challenges SET consumed_at=now() WHERE target_user_id=$1 AND requested_by=$2 AND consumed_at IS NULL",[id,actorId]);
    await query("INSERT INTO user_deletion_challenges(target_user_id,requested_by,otp_hash,expires_at)VALUES($1,$2,$3,$4)",[id,actorId,deletionOtpHash(otp,id,actorId),expiresAt]);
    await sendMail(target.email,"Confirm deletion of your Cresco CRM administrator account",`<p>Hello ${target.name},</p><p>Another administrator requested deletion of your CRM account.</p><p>Your deletion OTP is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>Share this OTP only if you approve the deletion. It expires in 10 minutes. If you did not expect this request, do not share it and contact another administrator.</p>`);
    return{status:200,body:{otpRequired:true,message:`OTP sent to ${target.email}. Enter it to confirm deletion.`,expiresInMinutes:10}};
  },
  async remove(id, actorId, otp) {
    if(id===actorId)return{status:400,body:{message:"You cannot delete your own account."}};
    const client=await getClient();
    try{await client.query("BEGIN");const target=(await client.query("SELECT id,name,email,is_admin,is_active FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",[id])).rows[0];if(!target){await client.query("ROLLBACK");return{status:404,body:{message:"User not found."}}}
      if(target.is_admin){const activeAdmins=+(await client.query("SELECT count(*) FROM users WHERE is_admin AND is_active AND deleted_at IS NULL")).rows[0].count;if(activeAdmins<=1){await client.query("ROLLBACK");return{status:409,body:{message:"The last active administrator cannot be deleted."}}}const challenge=(await client.query("SELECT * FROM user_deletion_challenges WHERE target_user_id=$1 AND requested_by=$2 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE",[id,actorId])).rows[0];if(!challenge||new Date(challenge.expires_at)<=new Date()){await client.query("ROLLBACK");return{status:400,body:{message:"Deletion OTP is missing or expired. Request a new OTP."}}}if(challenge.attempts>=5){await client.query("ROLLBACK");return{status:429,body:{message:"Too many invalid OTP attempts. Request a new OTP."}}}if(!sameHash(deletionOtpHash(String(otp||""),id,actorId),challenge.otp_hash)){await client.query("UPDATE user_deletion_challenges SET attempts=attempts+1 WHERE id=$1",[challenge.id]);await client.query("COMMIT");return{status:400,body:{message:"Invalid deletion OTP."}}}await client.query("UPDATE user_deletion_challenges SET consumed_at=now() WHERE id=$1",[challenge.id])}
      await client.query("UPDATE users SET is_active=FALSE,refresh_token=NULL,otp_code=NULL,otp_expires_at=NULL,reset_token=NULL,reset_expires_at=NULL,deleted_at=now(),deleted_by=$1 WHERE id=$2",[actorId,id]);await client.query("COMMIT");return{status:200,body:{message:`${target.name} was deleted and all active sessions were revoked.`}};
    }catch(error){await client.query("ROLLBACK");throw error}finally{client.release()}
  },
};
