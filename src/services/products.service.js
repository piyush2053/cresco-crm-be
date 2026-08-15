import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { query } from "../db.js";
import { config } from "../config.js";

const required = ["company", "country", "method", "grade", "application", "description"];
const methods = new Set(["Rutile", "Anatase"]);
const sortable = new Set(["id", "company", "country", "method", "grade", "application", "is_active", "sort_order", "created_at", "updated_at"]);

export function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function validate(payload, partial = false) {
  const clean = {};
  for (const key of required) {
    if (!partial || payload[key] !== undefined) {
      const value = String(payload[key] ?? "").trim();
      if (!value && key !== "country") throw Object.assign(new Error(`${key.replaceAll("_", " ")} is required.`), { status: 400 });
      clean[key] = value;
    }
  }
  if (clean.method !== undefined && !methods.has(clean.method)) throw Object.assign(new Error("Method must be Rutile or Anatase."), { status: 400 });
  if (!partial || payload.category !== undefined) clean.category = String(payload.category || "Titanium Dioxide (TiO2)").trim();
  if (!partial || payload.is_active !== undefined) clean.is_active = payload.is_active === undefined ? true : payload.is_active === true;
  if (!partial || payload.sort_order !== undefined) {
    const value = Number(payload.sort_order ?? 0);
    if (!Number.isInteger(value)) throw Object.assign(new Error("Sort order must be an integer."), { status: 400 });
    clean.sort_order = value;
  }
  return clean;
}

async function uniqueSlug(payload) {
  const base = slugify(`${payload.grade}-${payload.application}`) || "product";
  let slug = base, suffix = 2;
  while ((await query("SELECT 1 FROM website_products WHERE slug=$1", [slug])).rowCount) slug = `${base}-${suffix++}`;
  return slug;
}

function publicAsset(relative) {
  if (!relative) return null;
  const parts = String(relative).replaceAll("\\", "/").split("/").filter(Boolean);
  return `${config.productAssets.publicUrl}/${parts.map(encodeURIComponent).join("/")}`;
}

function publicRow(row) {
  return {
    id: row.legacy_id ?? row.id, company: row.company, country: row.country, method: row.method,
    grade: row.grade, application: row.application, description: row.description,
    datasheet: publicAsset(row.datasheet_path), sample: publicAsset(row.sample_path),
    slug: row.slug, category: row.category,
  };
}

function crmRow(row) {
  return row ? { ...row, datasheet_url: publicAsset(row.datasheet_path), sample_url: publicAsset(row.sample_path) } : null;
}

function safeAssetPath(relative) {
  if (!relative) return null;
  const root = path.resolve(config.productAssets.directory);
  const target = path.resolve(root, relative);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

async function removeIfUnreferenced(relative) {
  const target = safeAssetPath(relative);
  if (!target) return;
  const used = await query("SELECT 1 FROM website_products WHERE datasheet_path=$1 OR sample_path=$1 LIMIT 1", [relative]);
  if (!used.rowCount) await rm(target, { force: true });
}

export const ProductsService = {
  async list(params = {}) {
    const values = [], where = [];
    if (params.search) { values.push(`%${params.search}%`); where.push(`concat_ws(' ',company,country,method,grade,application,description) ILIKE $${values.length}`); }
    for (const key of ["company", "country", "method", "application"]) if (params[key]) { values.push(params[key]); where.push(`${key}=$${values.length}`); }
    if (params.is_active === "true" || params.is_active === "false") { values.push(params.is_active === "true"); where.push(`is_active=$${values.length}`); }
    const page = Math.max(1, Number.parseInt(params.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(params.limit, 10) || 25));
    const sort = sortable.has(params.sort) ? params.sort : "sort_order";
    const direction = String(params.direction).toLowerCase() === "desc" ? "DESC" : "ASC";
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = Number((await query(`SELECT count(*) FROM website_products ${clause}`, values)).rows[0].count);
    values.push(limit, (page - 1) * limit);
    const rows = (await query(`SELECT * FROM website_products ${clause} ORDER BY ${sort} ${direction},id ASC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows.map(crmRow);
    return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
  },
  async get(id) { return crmRow((await query("SELECT * FROM website_products WHERE id=$1", [id])).rows[0]); },
  async create(payload, userId) {
    const data = validate(payload), slug = await uniqueSlug(data);
    return crmRow((await query(`INSERT INTO website_products(company,country,method,grade,application,description,slug,category,is_active,sort_order,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`,
      [data.company,data.country,data.method,data.grade,data.application,data.description,slug,data.category,data.is_active,data.sort_order,userId])).rows[0]);
  },
  async update(id, payload, userId) {
    const data = validate(payload, true), keys = Object.keys(data);
    if (!keys.length) throw Object.assign(new Error("No editable product fields were supplied."), { status: 400 });
    const values = keys.map((key) => data[key]); values.push(userId, id);
    return crmRow((await query(`UPDATE website_products SET ${keys.map((key,index)=>`${key}=$${index+1}`).join(",")},updated_by=$${values.length-1} WHERE id=$${values.length} RETURNING *`, values)).rows[0]);
  },
  async remove(id) {
    const row = (await query("DELETE FROM website_products WHERE id=$1 RETURNING *", [id])).rows[0];
    if (!row) return null;
    await removeIfUnreferenced(row.datasheet_path);
    if (row.sample_path !== row.datasheet_path) await removeIfUnreferenced(row.sample_path);
    return crmRow(row);
  },
  async attachDatasheet(id, relativePath, userId) {
    await mkdir(path.dirname(safeAssetPath(relativePath)), { recursive: true });
    const row = (await query("UPDATE website_products SET datasheet_path=$1,sample_path=CASE WHEN sample_path IS NULL OR sample_path=datasheet_path THEN $1 ELSE sample_path END,updated_by=$2 WHERE id=$3 RETURNING *", [relativePath,userId,id])).rows[0];
    if (!row) return null;
    return crmRow(row);
  },
  removeIfUnreferenced,
  async publicList() { return (await query("SELECT * FROM website_products WHERE is_active ORDER BY sort_order,id")).rows.map(publicRow); },
};
