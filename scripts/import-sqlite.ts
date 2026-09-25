import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";

const sourcePath = resolve(process.env.SQLITE_IMPORT_PATH ?? "./data/waitinglist.sqlite3");
const dryRun = process.argv.includes("--dry-run");

if (!existsSync(sourcePath)) {
  throw new Error(`File SQLite tidak ditemukan: ${sourcePath}`);
}

const sqlite = new Database(sourcePath, { readonly: true });
let closeDatabase: (() => Promise<void>) | undefined;

try {
  const rows = sqlite.query("SELECT * FROM calon_santri_waitinglist ORDER BY created_at").all() as Record<string, unknown>[];
  console.info(`Record ditemukan di SQLite: ${rows.length}`);
  if (dryRun) {
    console.info("Dry run: belum ada data yang ditulis ke MariaDB.");
  } else {
    const { assertProductionSecurityConfig } = await import("../src/config");
    assertProductionSecurityConfig();
    const [{ db, closeDatabase: closeDb }, { calonSantriWaitinglist }, { encryptSensitiveRecord }] = await Promise.all([
      import("../src/db"),
      import("../src/db/schema"),
      import("../src/lib/encryption"),
    ]);
    closeDatabase = closeDb;
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
    let imported = 0;
    let skipped = 0;
    const batchSize = 100;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize).map((row) => {
        const rawCreatedAt = String(row.created_at);
        const parsedCreatedAt = new Date(rawCreatedAt);
        return {
          id: String(row.id),
          nama_ortu: String(row.nama_ortu),
          status_ortu: String(row.status_ortu) as "bapak" | "ibu",
          nama_anak: String(row.nama_anak),
          tanggal_lahir_anak: String(row.tanggal_lahir_anak),
          umur_terhitung_bulan: Number(row.umur_terhitung_bulan),
          status_eligibility: String(row.status_eligibility) as "eligible" | "not_eligible",
          provinsi_id: String(row.provinsi_id),
          provinsi_nama: String(row.provinsi_nama),
          kabupaten_id: String(row.kabupaten_id),
          kabupaten_nama: String(row.kabupaten_nama),
          kecamatan_id: String(row.kecamatan_id),
          kecamatan_nama: String(row.kecamatan_nama),
          desa_id: String(row.desa_id),
          desa_nama: String(row.desa_nama),
          no_hp_wa: String(row.no_hp_wa),
          email: String(row.email),
          konfirmasi_data: Number(row.konfirmasi_data),
          created_at: Number.isNaN(parsedCreatedAt.getTime()) ? rawCreatedAt : parsedCreatedAt.toISOString(),
        };
      });
      const ids = batch.map((row) => row.id);
      const existing = await db.select({ id: calonSantriWaitinglist.id })
        .from(calonSantriWaitinglist)
        .where(inArray(calonSantriWaitinglist.id, ids));
      const existingIds = new Set(existing.map((row) => row.id));
      const pending = batch.filter((row) => !existingIds.has(row.id));
      skipped += batch.length - pending.length;
      if (pending.length) {
        const encrypted = pending.map((row) => encryptSensitiveRecord({
          ...row,
          umur_terhitung_bulan: String(row.umur_terhitung_bulan),
        }));
        await db.insert(calonSantriWaitinglist).values(encrypted);
        imported += pending.length;
      }
    }
    console.info(`Migrasi selesai: ${imported} record diimpor, ${skipped} dilewati karena ID sudah ada.`);
  }
} finally {
  sqlite.close();
  await closeDatabase?.();
}
