import {
  index,
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
  },
  (table) => [
    index("idx_waitinglist_created_at").on(table.created_at),
  ],
);

export const systemSettings = mysqlTable("system_settings", {
  setting_key: varchar("setting_key", { length: 64 }).primaryKey(),
  setting_value: text("setting_value").notNull(),
  updated_at: varchar("updated_at", { length: 32 }).notNull(),
});
