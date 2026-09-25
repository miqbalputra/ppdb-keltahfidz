import { eq } from "drizzle-orm";
import { db } from "../db";
import { calonSantriWaitinglist } from "../db/schema";
import { encryptLegacyFields } from "./encryption";

/** Upgrade plaintext rows from earlier releases in-place before serving requests. */
export async function encryptLegacyWaitinglistRows(): Promise<number> {
  const rows = await db.select().from(calonSantriWaitinglist);
  // Validate every existing encrypted value before changing any plaintext rows.
  // This prevents a wrong key from partially encrypting a mixed/partially migrated table.
  const migrations = rows.map((row) => ({
    id: row.id,
    updates: encryptLegacyFields(row),
  }));
  let upgraded = 0;
  for (const { id, updates } of migrations) {
    if (!Object.keys(updates).length) continue;
    await db.update(calonSantriWaitinglist)
      .set(updates as Partial<typeof calonSantriWaitinglist.$inferInsert>)
      .where(eq(calonSantriWaitinglist.id, id));
    upgraded += 1;
  }
  return upgraded;
}
