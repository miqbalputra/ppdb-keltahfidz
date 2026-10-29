import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
process.env.DATA_ENCRYPTION_KEY ||= randomBytes(32).toString("hex");
const [{ generateParticipantPdf, generateParticipantsPdf }, { generateReportPdf }, { buildWaitinglistReport }, { encryptSensitiveRecord }] = await Promise.all([
  import("../src/lib/participant-export"), import("../src/lib/report-export"), import("../src/lib/waitinglist-report"), import("../src/lib/encryption"),
]);
const now = new Date(), today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
const records = Array.from({ length: 80 }, (_, i) => ({
  id: String(i + 1).padStart(32, "0"), nama_anak: i % 3 ? `Ahmad Zaid ${i + 1}` : "Maryam Éléonore Zahra Putri Abdullah", nama_ortu: "Siti Aminah Abdullah", status_ortu: "ibu",
  jenis_kelamin: i % 2 ? "putra" : "putri", sekolah_asal: "TAUD Griya Qur'an Tunas Ilmu", tanggal_lahir_anak: "2020-01-01", umur_terhitung_bulan: 90, status_eligibility: "eligible",
  provinsi_nama: "Jawa Barat", kabupaten_nama: "Kota Bandung", kecamatan_nama: "Sukasari", desa_nama: "Sukarasa", no_hp_wa: "6281234567890", email: "contoh@example.test",
  konfirmasi_data: 1, konfirmasi_bukti_transfer: 1, konfirmasi_ketentuan_biaya: 1, bukti_transfer_mime: "application/pdf",
  created_at: new Date(now.getTime() - i % 28 * 86400000).toISOString(), payment_status: i % 3 === 0 ? "needs_correction" : i % 3 === 1 ? "verified" : "pending",
  payment_date: i % 3 === 1 ? today : null, payment_reviewer: i % 3 === 2 ? null : "bendahara.contoh", payment_reviewed_at: now.toISOString(),
  payment_note: i % 3 === 0 ? "Mohon kirim ulang bukti transfer yang menampilkan tanggal, nominal, dan rekening tujuan dengan jelas." : "Pembayaran sesuai catatan bank.",
}));
await mkdir("output/pdf", { recursive: true });
const context = { scope: "Aktif dan arsip", filters: "Seluruh data contoh", generatedAt: now.toISOString() };
const report = buildWaitinglistReport(records.map(r => encryptSensitiveRecord({ ...r, umur_terhitung_bulan: String(r.umur_terhitung_bulan) })), { view: "all" }, now);
await Bun.write("output/pdf/contoh-formulir-peserta.pdf", await generateParticipantPdf(records[1]!));
await Bun.write("output/pdf/contoh-rekap-pendaftar.pdf", await generateParticipantsPdf(records, context));
await Bun.write("output/pdf/contoh-laporan-statistik.pdf", await generateReportPdf(report, { view: "all" }));
await Bun.write("output/pdf/contoh-laporan-pembayaran.pdf", await generateParticipantsPdf(records, context, true));
console.info("Empat contoh PDF dengan data fiktif tersedia di output/pdf.");
