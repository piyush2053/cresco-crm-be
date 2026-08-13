import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { query } from "../src/db.js";
import { sendMail } from "../src/utils.js";

const backupDir = process.env.BACKUP_DIR || "/app/backups";
const mode = process.argv[2] || "create";
const prefix = "cresco-prod-";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function backups() {
  const names = await readdir(backupDir);
  return names.filter((name) => name.startsWith(prefix) && name.endsWith(".backup")).sort().reverse();
}

async function createBackup() {
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const filename = `${prefix}${stamp}.backup`;
  const finalPath = path.join(backupDir, filename);
  const temporaryPath = `${finalPath}.partial`;
  const connection = [
    "--host", process.env.DB_HOST,
    "--port", process.env.DB_PORT || "5432",
    "--username", process.env.DB_USER,
    "--dbname", process.env.DB_NAME,
  ];
  const env = { ...process.env, PGPASSWORD: process.env.DB_PASSWORD };

  try {
    // PostgreSQL custom format contains schema, tables, data, indexes, constraints and sequences.
    await run("pg_dump", [...connection, "--format=custom", "--compress=6", "--no-owner", "--no-privileges", "--file", temporaryPath], { env });
    await run("pg_restore", ["--list", temporaryPath], { env });
    await rename(temporaryPath, finalPath);

    // Retain exactly the newest successfully-created and validated backup.
    for (const oldName of (await backups()).filter((name) => name !== filename)) {
      await rm(path.join(backupDir, oldName), { force: true });
    }
    const details = await stat(finalPath);
    console.log(`Backup completed: ${finalPath} (${details.size} bytes)`);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function emailLatestBackup() {
  await mkdir(backupDir, { recursive: true });
  const [latest] = await backups();
  if (!latest) throw new Error("No validated database backup is available to email.");
  const backupPath = path.join(backupDir, latest);
  const details = await stat(backupPath);
  const admins = (await query(
    "SELECT name,email FROM users WHERE is_admin AND is_active AND email_verified AND deleted_at IS NULL ORDER BY id"
  )).rows;
  if (!admins.length) throw new Error("No active, verified administrator email address was found.");

  const results = await Promise.allSettled(admins.map((admin) => sendMail(
    admin.email,
    "Cresco CRM weekly full database backup",
    `<p>Hello ${admin.name || "Admin"},</p><p>The latest validated full Cresco CRM PostgreSQL backup is attached.</p><p>File: ${latest}<br>Size: ${(details.size / 1024 / 1024).toFixed(2)} MB</p><p>Store this sensitive file securely. It contains the complete CRM database.</p>`,
    { attachments: [{ filename: latest, path: backupPath, contentType: "application/octet-stream" }] }
  )));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new Error(`Backup email failed for ${failures.length} of ${admins.length} administrators: ${failures.map((x) => x.reason?.message).join("; ")}`);
  console.log(`Backup emailed successfully to ${admins.length} administrator(s).`);
}

try {
  if (mode === "create") await createBackup();
  else if (mode === "email-latest") await emailLatestBackup();
  else throw new Error(`Unknown mode: ${mode}`);
  process.exit(0);
} catch (error) {
  console.error(`Database backup job failed: ${error.stack || error.message}`);
  process.exit(1);
}
