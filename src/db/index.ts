import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./schema";
import { DATABASE_URL, DB_POOL_SIZE, DB_SSL } from "../config";

export const pool = mysql.createPool({
  uri: DATABASE_URL,
  charset: "utf8mb4",
  connectTimeout: 5_000,
  waitForConnections: true,
  connectionLimit: DB_POOL_SIZE,
  maxIdle: 5,
  idleTimeout: 60_000,
  enableKeepAlive: true,
  ssl: DB_SSL ? { rejectUnauthorized: true } : undefined,
});

export const db = drizzle({ client: pool, schema, mode: "default" });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
