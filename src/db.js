import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export function query(text, params = []) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}
