import jwt from "jsonwebtoken";
import { query } from "../db.js";
import {
  hashPassword,
  comparePassword,
  createToken,
  createRefreshToken,
  generateOtp,
  sendMail,
  safeJson,
} from "../utils.js";
import { config } from "../config.js";
import { alertAdmins } from "./admin-alerts.service.js";

export const AuthService = {
  async login(email, password) {
    const result = await query(
      "SELECT id, password, is_admin, role_id, email_verified, name FROM users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    if (!user || !comparePassword(password, user.password)) {
      return { status: 401, body: { message: "Invalid credentials." } };
    }

    const token = createToken({ userId: user.id });
    const refreshToken = createRefreshToken({ userId: user.id });
    await query(
      "UPDATE users SET refresh_token = $1, last_login = now() WHERE id = $2",
      [refreshToken, user.id]
    );
    await alertAdmins("User login",`${user.name} (${email}) logged into the CRM.`,"info","/settings");

    return {
      status: 200,
      body: {
        token,
        refreshToken,
        user: safeJson({
          id: user.id,
          name: user.name,
          email,
          role_id: user.role_id,
          is_admin: user.is_admin,
        }),
      },
    };
  },

  async verifyOtp(email, otp) {
    const result = await query(
      "SELECT id, otp_code, otp_expires_at, is_admin, role_id FROM users WHERE email = $1",
      [email]
    );
    await alertAdmins("New user created",`${name} (${email}) created a CRM account.`,"success","/settings");
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
    return { status: 200, body: { token, refreshToken } };
  },

  async signup(name, email, password, roleId) {
    const existing = await query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rowCount > 0) {
      return { status: 409, body: { message: "Email already exists." } };
    }

    const hashed = hashPassword(password);
    const isAdmin = roleId === 1;
    const result = await query(
      "INSERT INTO users (name, email, password, role_id, is_admin, email_verified) VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id, email",
      [name, email, hashed, roleId, isAdmin]
    );

    return { status: 201, body: { user: safeJson(result.rows[0]) } };
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
    await sendMail(
      email,
      "Reset your Cresco CRM password",
      `<p>Use this link to reset your password: <strong>${config.app.apiUrl}/reset-password?token=${token}</strong></p>`
    );
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
      const result = await query("SELECT id FROM users WHERE id = $1 AND refresh_token = $2", [payload.userId, refreshToken]);
      if (result.rowCount === 0) {
        return { status: 401, body: { message: "Invalid refresh token." } };
      }
      const token = createToken({ userId: payload.userId });
      return { status: 200, body: { token } };
    } catch (error) {
      return { status: 401, body: { message: "Invalid refresh token." } };
    }
  },

  async logout(refreshToken) {
    if (!refreshToken) {
      return { status: 200, body: { message: "Signed out successfully." } };
    }

    try {
      const payload = jwt.verify(refreshToken, config.app.jwtSecret);
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
