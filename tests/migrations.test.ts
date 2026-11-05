import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import * as schema from "../src/db/schema";

const migrationsFolder = resolve(import.meta.dir, "../drizzle");
const receiptTables = [schema.paymentReceiptAttempts, schema.paymentReceiptEvents];
const receiptForeignKeys = receiptTables.flatMap(table => getTableConfig(table).foreignKeys.map(key => key.getName())).sort();

test("migration and schema identifiers fit the MariaDB 64-character limit", async () => {
  const oversized: string[] = [];
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const names = [config.name, ...config.columns.map(column => column.name),
      ...config.foreignKeys.map(key => key.getName()), ...config.indexes.map(index => index.config.name),
      ...config.primaryKeys.map(key => key.getName()), ...config.uniqueConstraints.map(key => key.getName())];
    oversized.push(...names.filter((name): name is string => name !== undefined && name.length > 64));
  }
  for (const file of (await readdir(migrationsFolder)).filter(file => file.endsWith(".sql"))) {
    const sql = await readFile(join(migrationsFolder, file), "utf8");
    for (const match of sql.matchAll(/`([^`]+)`/g)) {
      if (match[1]!.length > 64) oversized.push(`${file}: ${match[1]}`);
    }
  }
  expect(oversized).toEqual([]);
});

test("receipt migration, schema, and latest snapshot use the same foreign keys", async () => {
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const latest = journal.entries.at(-1);
  const snapshot = JSON.parse(await readFile(join(migrationsFolder, `meta/${String(latest.idx).padStart(4, "0")}_snapshot.json`), "utf8"));
  const snapshotNames = receiptTables.flatMap(table => Object.keys(snapshot.tables[getTableConfig(table).name].foreignKeys)).sort();
  const sql = await readFile(join(migrationsFolder, "0009_petite_the_fallen.sql"), "utf8");
  const sqlNames = [...sql.matchAll(/ADD CONSTRAINT `([^`]+)` FOREIGN KEY/g)].map(match => match[1]).sort();
  expect(snapshotNames).toEqual(receiptForeignKeys);
  expect(sqlNames).toEqual(receiptForeignKeys);
});

const testDatabaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

test.skipIf(!testDatabaseUrl)("MariaDB resumes receipt migration at every DDL boundary and preserves rows", async () => {
  const url = new URL(testDatabaseUrl!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/spsb_migration_test_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("Use an empty local spsb_migration_test_* database for migration recovery tests.");
  }
  const connection = await createConnection(testDatabaseUrl!);
  let baselineFolder: string | undefined;
  try {
    const [existing] = await connection.query<RowDataPacket[]>("SHOW TABLES");
    if (existing.length) throw new Error("Migration recovery tests require an empty dedicated database.");
    const db = drizzle(connection);
    const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
    const receiptEntry = journal.entries.find((entry: { tag: string }) => entry.tag === "0009_petite_the_fallen");
    baselineFolder = await mkdtemp(join(tmpdir(), "spsb-migration-baseline-"));
    await mkdir(join(baselineFolder, "meta"));
    const baselineEntries = journal.entries.filter((entry: { idx: number }) => entry.idx < receiptEntry.idx);
    await writeFile(join(baselineFolder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: baselineEntries }));
    for (const entry of baselineEntries) {
      await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(baselineFolder, `${entry.tag}.sql`));
    }
    await migrate(db, { migrationsFolder: baselineFolder });
    const stamp = "2026-11-05T00:00:00.000Z";
    const participantId = "a".repeat(32);
    const attemptId = "c".repeat(32);
    const eventId = "e".repeat(32);
    const participant = {
      nama_ortu: "encrypted-parent", status_ortu: "encrypted-bapak", nama_anak: "encrypted-child",
      tanggal_lahir_anak: "encrypted-birth", umur_terhitung_bulan: "encrypted-age", status_eligibility: "eligible",
      provinsi_id: "province", provinsi_nama: "encrypted-province", kabupaten_id: "city", kabupaten_nama: "encrypted-city",
      kecamatan_id: "district", kecamatan_nama: "encrypted-district", desa_id: "village", desa_nama: "encrypted-village",
      no_hp_wa: "encrypted-phone", email: "encrypted-email", konfirmasi_data: 1, created_at: stamp,
      jalur_pendaftaran: "askar", askar_anggota: "encrypted-keduanya", askar_divisi_bapak: "encrypted-division",
    };
    await db.insert(schema.calonSantriWaitinglist).values([
      { ...participant, id: participantId, payment_status: "verified", payment_date: "2026-11-05", payment_note: "encrypted-note" },
      { ...participant, id: "b".repeat(32), deleted_at: stamp, deleted_by: "existing-admin" },
    ]);
    type PreservedTable = "calon_santri_waitinglist" | "payment_receipt_attempts" | "payment_receipt_events";
    const rows = async (table: PreservedTable) => (await connection.query<RowDataPacket[]>(`SELECT * FROM \`${table}\` ORDER BY id`))[0];
    const existingParticipants = await rows("calon_santri_waitinglist");
    const attempt = { id: attemptId, participant_id: participantId, proof_id: "d".repeat(32), participant_version: 1,
      status: "email_sent", method: "ocr", gmail_message_id: "existing-gmail-message", last_error: "encrypted-detail",
      created_at: stamp, updated_at: stamp, sent_at: stamp };
    const event = { id: eventId, attempt_id: attemptId, participant_id: participantId, event: "email_sent", actor: "n8n",
      execution_id: "existing-execution", payload: "encrypted-event", created_at: stamp };
    const receiptMigration = readMigrationFiles({ migrationsFolder }).find(migration => migration.folderMillis === receiptEntry.when)!;
    const statements = receiptMigration.sql.filter(statement => statement.trim());

    for (let completed = 0; completed <= statements.length; completed++) {
      await connection.query("DROP TABLE IF EXISTS payment_receipt_events");
      await connection.query("DROP TABLE IF EXISTS payment_receipt_attempts");
      await connection.execute("DELETE FROM __drizzle_migrations WHERE created_at = ?", [receiptEntry.when]);
      for (const statement of statements.slice(0, completed)) await connection.query(statement);
      if (completed >= 1) await db.insert(schema.paymentReceiptAttempts).values(attempt);
      if (completed >= 2) await db.insert(schema.paymentReceiptEvents).values(event);
      const existingAttempts = completed >= 1 ? await rows("payment_receipt_attempts") : [];
      const existingEvents = completed >= 2 ? await rows("payment_receipt_events") : [];

      await migrate(db, { migrationsFolder });
      expect(await rows("calon_santri_waitinglist")).toEqual(existingParticipants);
      expect(await rows("payment_receipt_attempts")).toEqual(existingAttempts);
      expect(await rows("payment_receipt_events")).toEqual(existingEvents);
      const [constraints] = await connection.query<RowDataPacket[]>(
        "SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME IN ('payment_receipt_attempts', 'payment_receipt_events')");
      expect(constraints.map(row => row.CONSTRAINT_NAME).sort()).toEqual(receiptForeignKeys);
      for (const table of receiptTables) {
        const config = getTableConfig(table);
        const [indexes] = await connection.query<RowDataPacket[]>(`SHOW INDEX FROM \`${config.name}\``);
        for (const index of config.indexes) expect(indexes.map(row => row.Key_name)).toContain(index.config.name);
      }
      let orphanError: unknown;
      try {
        await db.insert(schema.paymentReceiptAttempts).values({ ...attempt, id: "f".repeat(32), participant_id: "0".repeat(32) }).execute();
      } catch (error) {
        orphanError = error;
      }
      expect((orphanError as { cause?: { code?: string } } | undefined)?.cause?.code).toBe("ER_NO_REFERENCED_ROW_2");
      await migrate(db, { migrationsFolder });
      const [applied] = await connection.execute<RowDataPacket[]>("SELECT COUNT(*) AS total FROM __drizzle_migrations WHERE created_at = ?", [receiptEntry.when]);
      expect(Number(applied[0]!.total)).toBe(1);
    }
    console.info(`Receipt migration recovered from ${statements.length + 1} interruption points; existing participants and receipt logs preserved.`);
  } finally {
    await connection.end();
    if (baselineFolder) await rm(baselineFolder, { recursive: true, force: true });
  }
}, 120_000);
