import { defineConfig } from "drizzle-kit";

const user = process.env.DB_USER ?? "waitinglist";
const password = process.env.DB_PASSWORD ?? "";
const host = process.env.DB_HOST ?? "127.0.0.1";
const port = process.env.DB_PORT ?? "3306";
const database = process.env.DB_NAME ?? "waitinglist";
const url = process.env.DATABASE_URL
  ?? `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(database)}`;

export default defineConfig({
  dialect: "mysql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
