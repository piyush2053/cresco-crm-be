import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { config } from "./config.js";
import { query } from "./db.js";

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

export function createMailer() {
  return nodemailer.createTransport({
    host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

export async function sendMail(to, subject, html, options = {}) {
  let renderedSubject=subject,renderedHtml=html;
  try{
    const template=(await query("SELECT subject,body FROM settings_communication_templates WHERE channel='Email' AND is_active AND is_default ORDER BY updated_at DESC LIMIT 1")).rows[0];
    if(template){const values={subject,content:html,sent_at:new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})+" IST"},render=(text)=>String(text||"").replace(/{{\s*([a-z0-9_]+)\s*}}/gi,(_,key)=>values[key]??"");renderedSubject=render(template.subject)||subject;renderedHtml=render(template.body)}
  }catch(error){console.error("Mail template fallback:",error.message)}
  await createMailer().sendMail({ from: config.smtp.from, to, subject:renderedSubject, html:renderedHtml, ...options });
}

export function safeJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
