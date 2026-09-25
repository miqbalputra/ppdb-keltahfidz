import { randomBytes } from "node:crypto";
import { assertTurnstilePair, parseDbPoolSize, productionSecurityProblems } from "./lib/config-validation";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? fallback).trim();
}

export const NODE_ENV = env("NODE_ENV", "development");
export const HOST = env("HOST", "127.0.0.1");
export const PORT = Number(env("PORT", "8000"));
export const DATA_DIR = env("DATA_DIR", "./data");
export const ADMIN_USERNAME = env("ADMIN_USERNAME", "admin");

const configuredAdminPassword = env("ADMIN_PASSWORD");
export const ADMIN_PASSWORD_CONFIGURED = Boolean(configuredAdminPassword);
export const ADMIN_PASSWORD = configuredAdminPassword || randomBytes(18).toString("base64url");

const configuredAppSecret = env("APP_SECRET");
export const APP_SECRET_CONFIGURED = Boolean(configuredAppSecret);
export const APP_SECRET = configuredAppSecret || randomBytes(32).toString("hex");

export const COOKIE_SECURE = /^(1|true|yes)$/i.test(env("COOKIE_SECURE", "false"));
export const DB_SSL = /^(1|true|yes)$/i.test(env("DB_SSL", "false"));
export const N8N_WEBHOOK_URL = env("N8N_WEBHOOK_URL");
export const TURNSTILE_SITE_KEY = env("TURNSTILE_SITE_KEY");
export const TURNSTILE_SECRET_KEY = env("TURNSTILE_SECRET_KEY");
assertTurnstilePair(TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY);
export const TURNSTILE_ENABLED = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
export const DB_POOL_SIZE = parseDbPoolSize(env("DB_POOL_SIZE", "10"));
export const MAX_REQUEST_BYTES = 32 * 1024;
export const SESSION_COOKIE = COOKIE_SECURE ? "__Host-psb_admin_session" : "psb_admin_session";

const encryptionKeyValue = env("DATA_ENCRYPTION_KEY");
export const DATA_ENCRYPTION_KEY_CONFIGURED = Boolean(encryptionKeyValue);
let encryptionKey: Buffer;
if (/^[\da-f]{64}$/i.test(encryptionKeyValue)) {
  encryptionKey = Buffer.from(encryptionKeyValue, "hex");
} else {
  encryptionKey = Buffer.from(encryptionKeyValue, "base64");
  if (!encryptionKeyValue || encryptionKey.length !== 32 || encryptionKey.toString("base64") !== encryptionKeyValue) {
    throw new Error("DATA_ENCRYPTION_KEY wajib berisi 32 byte dalam format hex 64 karakter atau Base64.");
  }
}
if (encryptionKey.length !== 32) {
  throw new Error("DATA_ENCRYPTION_KEY harus tepat 32 byte.");
}
export const DATA_ENCRYPTION_KEY = encryptionKey;

export function getDatabaseUrl(): string {
  const configuredUrl = env("DATABASE_URL");
  if (configuredUrl) return configuredUrl;

  const user = encodeURIComponent(env("DB_USER", "waitinglist"));
  const password = encodeURIComponent(env("DB_PASSWORD"));
  const host = env("DB_HOST", "127.0.0.1");
  const port = env("DB_PORT", "3306");
  const database = encodeURIComponent(env("DB_NAME", "waitinglist"));
  return `mysql://${user}:${password}@${host}:${port}/${database}`;
}

export const DATABASE_URL = getDatabaseUrl();

export function assertProductionSecurityConfig(): void {
  if (NODE_ENV !== "production") return;
  const problems = productionSecurityProblems({
    adminPasswordConfigured: ADMIN_PASSWORD_CONFIGURED,
    adminPassword: ADMIN_PASSWORD,
    appSecretConfigured: APP_SECRET_CONFIGURED,
    appSecret: APP_SECRET,
    cookieSecure: COOKIE_SECURE,
    encryptionKeyConfigured: DATA_ENCRYPTION_KEY_CONFIGURED,
    databaseUrl: DATABASE_URL,
    webhookUrl: N8N_WEBHOOK_URL,
  });
  if (problems.length) {
    throw new Error(`Konfigurasi production tidak aman: ${problems.join("; ")}.`);
  }
}

export function getInitialSettings() {
  return {
    cutoffDate: env("CUTOFF_DATE", "2027-07-01"),
    minAgeYears: Number(env("MIN_AGE_YEARS", "6")),
    minAgeMonths: Number(env("MIN_AGE_MONTHS", "6")),
    whatsappGroupUrl: env("WHATSAPP_GROUP_URL"),
  };
}
