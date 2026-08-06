import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { config } from "./config.js";

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

export function createToken(data) {
  return jwt.sign(data, config.app.jwtSecret, {
    expiresIn: config.app.jwtExpiresIn,
  });
}

export function createRefreshToken(data) {
  return jwt.sign(data, config.app.jwtSecret, {
    expiresIn: config.app.refreshExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.app.jwtSecret);
}

export function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function sendMail(to, subject, html) {
  const transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: {
      user: config.smtp.user,
      pass: config.smtp.pass,
    },
  });

  await transporter.sendMail({
    from: config.smtp.from,
    to,
    subject,
    html,
  });
}

export function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
