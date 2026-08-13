import jwt from "jsonwebtoken";
import { query } from "../db.js";
import {
  hashPassword,
  comparePassword,
  createToken,
  createRefreshToken,
  generateOtp,
  safeJson,
} from "../utils.js";
import { config } from "../config.js";
import { EmailNotificationsService } from "./email-notifications.service.js";
import { ActivityService } from "./activity.service.js";

export const AuthService = {
  async session(userId) {
    const user=(await query("SELECT u.id,u.name,u.email,u.role_id,u.is_admin,r.name role_name,r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.is_active AND u.deleted_at IS NULL",[userId])).rows[0];
    if(!user) return null;
    return safeJson({...user,permissions:user.permissions||{modules:{},actions:{}}});
  },
  async login(email, password) {
    const result = await query(
      "SELECT u.id,u.password,u.is_admin,u.is_active,u.role_id,u.email_verified,u.name,r.name role_name,r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1) AND u.deleted_at IS NULL",
      [email]
    );
    const user = result.rows[0];
    if (!user || !comparePassword(password, user.password)) {
      return { status: 401, body: { message: "Invalid credentials." } };
    }
    if (!user.is_active) return { status: 403, body: { message: "This account is inactive. Contact an administrator." } };
    if (!user.email_verified) return { status: 403, body: { message: "Verify your email before signing in. Enter the OTP sent to your email.", verificationRequired: true, email } };

    const token = createToken({ userId: user.id });
    const refreshToken = createRefreshToken({ userId: user.id });
    await query(
      "UPDATE users SET refresh_token = $1, last_login = now() WHERE id = $2",
      [refreshToken, user.id]
    );
    const activitySessionId = await ActivityService.start(user.id);
    await EmailNotificationsService.dispatch("user_login",{title:"User login",message:`${user.name} (${email}) logged into the CRM.`,type:"info",link:"/settings",subject:"Cresco CRM: User login",html:`<p>${user.name} (${email}) logged into the CRM.</p>`});

    return {
      status: 200,
      body: {
        token,
        refreshToken,
        activitySessionId,
        user: safeJson({
          id: user.id,
          name: user.name,
          email,
          role_id: user.role_id,
          role_name: user.role_name,
          is_admin: user.is_admin,
          permissions: user.permissions || { modules: {}, actions: {} },
        }),
      },
    };
  },

  async verifyOtp(email, otp) {
    const result = await query(
      "SELECT u.id,u.name,u.email,u.otp_code,u.otp_expires_at,u.is_admin,u.role_id,r.name role_name,r.permissions FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE lower(u.email)=lower($1) AND u.is_active AND u.deleted_at IS NULL",
      [email]
    );
    const user = result.rows[0];
    if (!user || user.otp_code !== otp || !user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return { status: 400, body: { message: "Invalid or expired OTP." } };
    }

    const token = createToken({ userId: user.id });
    const refreshToken = createRefreshToken({ userId: user.id });
    await query(
      "UPDATE users SET otp_code = NULL, otp_expires_at = NULL, refresh_token = $1, email_verified = TRUE, last_login = now() WHERE id = $2",
      [refreshToken, user.id]
    );
    const activitySessionId=await ActivityService.start(user.id);
    return { status: 200, body: { token,refreshToken,activitySessionId,user:safeJson({id:user.id,name:user.name,email:user.email,role_id:user.role_id,role_name:user.role_name,is_admin:user.is_admin,permissions:user.permissions||{modules:{},actions:{}}}) } };
  },
  async resendVerification(email) {
    const user=(await query("SELECT id,name,email,email_verified,is_active FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL",[email])).rows[0];
    if(!user||user.email_verified||!user.is_active)return{status:200,body:{message:"If this account requires verification, a new OTP was sent."}};
    const otp=generateOtp(),expiresAt=new Date(Date.now()+config.app.otpExpiresMinutes*60*1000);
    await query("UPDATE users SET otp_code=$1,otp_expires_at=$2 WHERE id=$3",[otp,expiresAt,user.id]);
    await EmailNotificationsService.dispatch("email_verification",{actorEmail:user.email,recipients:[user.email],subject:"Your new Cresco CRM verification OTP",html:`<p>Hello ${user.name},</p><p>Your new verification OTP is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${otp}</p><p>It expires in ${config.app.otpExpiresMinutes} minutes.</p>`});
    return{status:200,body:{message:"A new verification OTP was sent."}};
  },

  async signup(name, email, password, roleId) {
    return { status: 403, body: { message: "Self-signup is disabled. Ask an administrator to create your CRM account." } };
  },

  async forgotPassword(email) {
    const result = await query("SELECT id FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user) {
      return { status: 200, body: { message: "If this email exists, reset instructions were sent." } };
    }

    const token = createToken({ userId: user.id });
    const expiresAt = new Date(Date.now() + 3600_000);
    await query("UPDATE users SET reset_token = $1, reset_expires_at = $2 WHERE id = $3", [token, expiresAt, user.id]);
    const resetUrl=`${config.app.frontendUrl.replace(/\/$/,"")}/reset-password?token=${encodeURIComponent(token)}`;
    await EmailNotificationsService.dispatch("password_reset",{actorEmail:email,subject:"Reset your Cresco CRM password",html:`<p>We received a request to reset your Cresco CRM password.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`});
    return { status: 200, body: { message: "Reset instructions sent if email exists." } };
  },

  async resetPassword(token, password) {
    try {
      const payload = jwt.verify(token, config.app.jwtSecret);
      const result = await query("SELECT id, reset_expires_at, reset_token FROM users WHERE id = $1", [payload.userId]);
      const user = result.rows[0];
      if (!user || user.reset_token !== token || !user.reset_expires_at || new Date(user.reset_expires_at) < new Date()) {
        return { status: 400, body: { message: "Invalid or expired reset token." } };
      }
      const hashed = hashPassword(password);
      await query("UPDATE users SET password = $1, reset_token = NULL, reset_expires_at = NULL WHERE id = $2", [hashed, payload.userId]);
      return { status: 200, body: { message: "Password reset successfully." } };
    } catch (error) {
      return { status: 400, body: { message: "Invalid or expired reset token." } };
    }
  },

  async refreshToken(refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, config.app.jwtSecret);
      const result = await query("SELECT id FROM users WHERE id = $1 AND refresh_token = $2 AND is_active AND deleted_at IS NULL", [payload.userId, refreshToken]);
      if (result.rowCount === 0) {
        return { status: 401, body: { message: "Invalid refresh token." } };
      }
      const token = createToken({ userId: payload.userId });
      return { status: 200, body: { token } };
    } catch (error) {
      return { status: 401, body: { message: "Invalid refresh token." } };
    }
  },

  async logout(refreshToken, activitySessionId) {
    if (!refreshToken) {
      return { status: 200, body: { message: "Signed out successfully." } };
    }

    try {
      const payload = jwt.verify(refreshToken, config.app.jwtSecret);
      await ActivityService.heartbeat(payload.userId, activitySessionId, true);
      await query(
        "UPDATE users SET refresh_token = NULL WHERE id = $1 AND refresh_token = $2",
        [payload.userId, refreshToken]
      );
    } catch {
      // The client must still be able to clear its local session if its token expired.
    }

    return { status: 200, body: { message: "Signed out successfully." } };
  },
};
