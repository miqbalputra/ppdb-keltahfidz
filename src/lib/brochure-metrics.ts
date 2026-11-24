import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { systemSettings } from "../db/schema";

// Internal metrics are excluded from the editable and seeded settings keys.
export const BROCHURE_DOWNLOAD_COUNT_KEY = "brochureDownloadCount";
export const BROCHURE_VIEW_COUNT_KEY = "brochureViewCount";

type BrochureCountKey = typeof BROCHURE_DOWNLOAD_COUNT_KEY | typeof BROCHURE_VIEW_COUNT_KEY;

export async function getBrochureCount(key: BrochureCountKey): Promise<number> {
  const [row] = await db.select({ value: systemSettings.setting_value })
    .from(systemSettings)
    .where(eq(systemSettings.setting_key, key))
    .limit(1);
  if (!row) return 0;
  const count = Number(row.value);
  if (!/^\d+$/.test(row.value) || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Invalid stored brochure count for ${key}`);
  }
  return count;
}

export async function recordBrochureCount(key: BrochureCountKey): Promise<void> {
  const now = new Date().toISOString();
  // One atomic statement: concurrent requests/instances cannot overwrite each
  // other's increments, including when the counter has never been created.
  await db.insert(systemSettings).values({
    setting_key: key,
    setting_value: "1",
    updated_at: now,
  }).onDuplicateKeyUpdate({
    set: {
      setting_value: sql`CAST(${systemSettings.setting_value} AS UNSIGNED) + 1`,
      updated_at: now,
    },
  });
}
