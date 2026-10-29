import {
  index,
  int,
  mysqlTable,
  text,
  tinyint,
  varchar,
} from "drizzle-orm/mysql-core";

export const calonSantriWaitinglist = mysqlTable(
  "calon_santri_waitinglist",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    nama_ortu: text("nama_ortu").notNull(),
    status_ortu: text("status_ortu").notNull(),
    nama_anak: text("nama_anak").notNull(),
    jenis_kelamin: text("jenis_kelamin"),
    sekolah_asal: text("sekolah_asal"),
    bukti_transfer_mime: text("bukti_transfer_mime"),
    tanggal_lahir_anak: text("tanggal_lahir_anak").notNull(),
    umur_terhitung_bulan: text("umur_terhitung_bulan").notNull(),
    status_eligibility: text("status_eligibility").notNull(),
    provinsi_id: text("provinsi_id").notNull(),
    provinsi_nama: text("provinsi_nama").notNull(),
    kabupaten_id: text("kabupaten_id").notNull(),
    kabupaten_nama: text("kabupaten_nama").notNull(),
    kecamatan_id: text("kecamatan_id").notNull(),
    kecamatan_nama: text("kecamatan_nama").notNull(),
    desa_id: text("desa_id").notNull(),
    desa_nama: text("desa_nama").notNull(),
    no_hp_wa: text("no_hp_wa").notNull(),
    email: text("email").notNull(),
    konfirmasi_data: tinyint("konfirmasi_data", { unsigned: true }).notNull(),
    konfirmasi_bukti_transfer: tinyint("konfirmasi_bukti_transfer", { unsigned: true }),
    konfirmasi_ketentuan_biaya: tinyint("konfirmasi_ketentuan_biaya", { unsigned: true }),
    created_at: varchar("created_at", { length: 32 }).notNull(),
    deleted_at: varchar("deleted_at", { length: 32 }),
    deleted_by: varchar("deleted_by", { length: 120 }),
    version: int("version", { unsigned: true }).notNull().default(1),
    updated_at: varchar("updated_at", { length: 32 }),
    updated_by: varchar("updated_by", { length: 120 }),
    proof_id: varchar("proof_id", { length: 32 }),
    payment_status: varchar("payment_status", { length: 24 }).notNull().default("pending"),
    payment_date: varchar("payment_date", { length: 10 }),
    payment_reviewed_at: varchar("payment_reviewed_at", { length: 32 }),
    payment_reviewer: varchar("payment_reviewer", { length: 120 }),
    payment_note: text("payment_note"),
  },
  (table) => [
    index("idx_waitinglist_created_at").on(table.created_at),
    index("idx_waitinglist_payment").on(table.payment_status, table.payment_date),
    index("idx_waitinglist_archived").on(table.deleted_at),
  ],
);

export const systemSettings = mysqlTable("system_settings", {
  setting_key: varchar("setting_key", { length: 64 }).primaryKey(),
  setting_value: text("setting_value").notNull(),
  updated_at: varchar("updated_at", { length: 32 }).notNull(),
});

export const staffUsers = mysqlTable("staff_users", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 120 }).notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: varchar("role", { length: 16 }).notNull(),
  active: tinyint("active", { unsigned: true }).notNull().default(1),
  must_change_password: tinyint("must_change_password", { unsigned: true }).notNull().default(1),
  version: int("version", { unsigned: true }).notNull().default(1),
  created_at: varchar("created_at", { length: 32 }).notNull(),
});

export const staffSessions = mysqlTable("staff_sessions", {
  token_hash: varchar("token_hash", { length: 64 }).primaryKey(),
  user_id: varchar("user_id", { length: 32 }).notNull().references(() => staffUsers.id),
  expires_at: varchar("expires_at", { length: 32 }).notNull(),
}, table => [index("idx_staff_session_expiry").on(table.expires_at)]);

export const participantProofs = mysqlTable("participant_proofs", {
  id: varchar("id", { length: 32 }).primaryKey(),
  participant_id: varchar("participant_id", { length: 32 }).notNull().references(() => calonSantriWaitinglist.id),
  storage_key: varchar("storage_key", { length: 80 }).notNull(),
  encryption_context: varchar("encryption_context", { length: 80 }).notNull(),
  mime: varchar("mime", { length: 40 }).notNull(),
  size: int("size", { unsigned: true }).notNull(),
  created_at: varchar("created_at", { length: 32 }).notNull(),
  created_by: varchar("created_by", { length: 120 }),
}, table => [index("idx_proof_participant").on(table.participant_id)]);

export const auditEvents = mysqlTable("audit_events", {
  id: varchar("id", { length: 32 }).primaryKey(),
  subject_id: varchar("subject_id", { length: 32 }).notNull(),
  actor: varchar("actor", { length: 120 }).notNull(),
  action: varchar("action", { length: 48 }).notNull(),
  payload: text("payload").notNull(),
  created_at: varchar("created_at", { length: 32 }).notNull(),
}, table => [index("idx_audit_subject").on(table.subject_id, table.created_at)]);
