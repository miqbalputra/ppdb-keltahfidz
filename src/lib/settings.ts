import { eq, sql } from "drizzle-orm";
import { getInitialSettings } from "../config";
import { db } from "../db";
import { systemSettings } from "../db/schema";
import { validateSettings, type SystemSettings } from "./validation";

const settingKeys = ["cutoffDate", "minAgeYears", "minAgeMonths", "whatsappGroupUrl"] as const;

export async function getSystemSettings(): Promise<SystemSettings> {
  const rows = await db.select().from(systemSettings);
  const saved = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const defaults = validateSettings(getInitialSettings());
  return {
    cutoffDate: saved.get("cutoffDate") ?? defaults.cutoffDate,
    minAgeYears: Number(saved.get("minAgeYears") ?? defaults.minAgeYears),
    minAgeMonths: Number(saved.get("minAgeMonths") ?? defaults.minAgeMonths),
    whatsappGroupUrl: saved.get("whatsappGroupUrl") ?? defaults.whatsappGroupUrl,
  };
}

export async function seedSystemSettings(): Promise<void> {
  const existing = await db.select({ setting_key: systemSettings.setting_key }).from(systemSettings);
  const keys = new Set(existing.map((row) => row.setting_key));
  const defaults = validateSettings(getInitialSettings());
  const values: Record<(typeof settingKeys)[number], string> = {
    cutoffDate: defaults.cutoffDate,
    minAgeYears: String(defaults.minAgeYears),
    minAgeMonths: String(defaults.minAgeMonths),
    whatsappGroupUrl: defaults.whatsappGroupUrl,
  };
  const missing = settingKeys.filter((key) => !keys.has(key));
  if (!missing.length) return;
  const now = new Date().toISOString();
  await db.insert(systemSettings).values(
    missing.map((key) => ({ setting_key: key, setting_value: values[key], updated_at: now })),
  ).onDuplicateKeyUpdate({ set: { updated_at: sql`values(${systemSettings.updated_at})` } });
}

export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(systemSettings).values([
    { setting_key: "cutoffDate", setting_value: settings.cutoffDate, updated_at: now },
    { setting_key: "minAgeYears", setting_value: String(settings.minAgeYears), updated_at: now },
    { setting_key: "minAgeMonths", setting_value: String(settings.minAgeMonths), updated_at: now },
    { setting_key: "whatsappGroupUrl", setting_value: settings.whatsappGroupUrl, updated_at: now },
  ]).onDuplicateKeyUpdate({
    set: {
      setting_value: sql`values(${systemSettings.setting_value})`,
      updated_at: now,
    },
  });
}

export async function getSettingUpdatedAt(): Promise<string | null> {
  const [row] = await db.select({ updated_at: systemSettings.updated_at })
    .from(systemSettings)
    .where(eq(systemSettings.setting_key, "cutoffDate"))
    .limit(1);
  return row?.updated_at ?? null;
}
