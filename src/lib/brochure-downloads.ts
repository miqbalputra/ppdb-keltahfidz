import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { systemSettings } from "../db/schema";

// Internal metric: deliberately excluded from the editable/seeded settings keys.
export const BROCHURE_DOWNLOAD_COUNT_KEY = "brochureDownloadCount";

export async function getBrochureDownloadCount(): Promise<number> {
  const [row] = await db.select({ value: systemSettings.setting_value })
    .from(systemSettings)
    .where(eq(systemSettings.setting_key, BROCHURE_DOWNLOAD_COUNT_KEY))
    .limit(1);
  if (!row) return 0;
  const count = Number(row.value);
  if (!/^\d+$/.test(row.value) || !Number.isSafeInteger(count) || count < 0) {
    throw new Error("Invalid stored brochure download count");
  }
  return count;
}

export async function recordBrochureDownload(): Promise<void> {
  const now = new Date().toISOString();
  // One atomic statement: concurrent requests/instances cannot overwrite each
  // other's increments, including when the counter has never been created.
  await db.insert(systemSettings).values({
    setting_key: BROCHURE_DOWNLOAD_COUNT_KEY,
    setting_value: "1",
    updated_at: now,
  }).onDuplicateKeyUpdate({
    set: {
      setting_value: sql`CAST(${systemSettings.setting_value} AS UNSIGNED) + 1`,
      updated_at: now,
    },
  });
}
