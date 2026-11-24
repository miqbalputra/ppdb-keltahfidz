import { eq, sql } from "drizzle-orm";
import { getInitialSettings } from "../config";
import { db } from "../db";
import { systemSettings } from "../db/schema";
import { validateSettings, type SystemSettings } from "./validation";

const optionalSettingDefaults = {
  askarOpeningDateTime: "",
  registrationClosed: "false",
  closingDateTime: "",
  askarRegistrationClosed: "false",
  askarClosingDateTime: "",
};
const optionalSettingKeys = Object.keys(optionalSettingDefaults) as (keyof typeof optionalSettingDefaults)[];

export async function getSystemSettings(): Promise<SystemSettings> {
  const rows = await db.select().from(systemSettings);
  const saved = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  const defaults = validateSettings(getInitialSettings());
  const coreSettings = validateSettings({
    cutoffDate: saved.get("cutoffDate") ?? defaults.cutoffDate,
    minAgeYears: Number(saved.get("minAgeYears") ?? defaults.minAgeYears),
    minAgeMonths: Number(saved.get("minAgeMonths") ?? defaults.minAgeMonths),
    whatsappGroupUrl: saved.get("whatsappGroupUrl") ?? defaults.whatsappGroupUrl,
    openingCountdownEnabled: false,
    openingDateTime: "",
  });
  return {
    ...coreSettings,
    openingCountdownEnabled: saved.get("openingCountdownEnabled") === "true",
    openingDateTime: saved.get("openingDateTime") ?? "",
    askarOpeningDateTime: saved.get("askarOpeningDateTime") ?? "",
    registrationClosed: saved.get("registrationClosed") === "true",
    closingDateTime: saved.get("closingDateTime") ?? "",
    askarRegistrationClosed: saved.get("askarRegistrationClosed") === "true",
    askarClosingDateTime: saved.get("askarClosingDateTime") ?? "",
  };
}

export async function seedSystemSettings(): Promise<void> {
  const existing = await db.select({ setting_key: systemSettings.setting_key }).from(systemSettings);
  const keys = new Set(existing.map((row) => row.setting_key));
  const defaults = validateSettings(getInitialSettings());
  const values = {
    cutoffDate: defaults.cutoffDate,
    minAgeYears: String(defaults.minAgeYears),
    minAgeMonths: String(defaults.minAgeMonths),
    whatsappGroupUrl: defaults.whatsappGroupUrl,
    openingCountdownEnabled: "false",
    openingDateTime: "",
    ...optionalSettingDefaults,
  };
  const missing = (Object.keys(values) as (keyof typeof values)[]).filter((key) => !keys.has(key));
  if (!missing.length) return;
  const now = new Date().toISOString();
  await db.insert(systemSettings).values(
    missing.map((key) => ({ setting_key: key, setting_value: values[key], updated_at: now })),
  ).onDuplicateKeyUpdate({ set: { updated_at: sql`values(${systemSettings.updated_at})` } });
}

export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  const now = new Date().toISOString();
  const rows = [
    { setting_key: "cutoffDate", setting_value: settings.cutoffDate, updated_at: now },
    { setting_key: "minAgeYears", setting_value: String(settings.minAgeYears), updated_at: now },
    { setting_key: "minAgeMonths", setting_value: String(settings.minAgeMonths), updated_at: now },
    { setting_key: "whatsappGroupUrl", setting_value: settings.whatsappGroupUrl, updated_at: now },
    { setting_key: "openingCountdownEnabled", setting_value: String(settings.openingCountdownEnabled), updated_at: now },
    { setting_key: "openingDateTime", setting_value: settings.openingDateTime, updated_at: now },
  ];
  for (const key of optionalSettingKeys) {
    if (settings[key] !== undefined) {
      rows.push({ setting_key: key, setting_value: String(settings[key]), updated_at: now });
    }
  }
  await db.insert(systemSettings).values(rows).onDuplicateKeyUpdate({
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
