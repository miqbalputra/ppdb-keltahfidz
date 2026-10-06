import { expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
  generateParticipantPdf,
  generateParticipantXlsx,
  generateParticipantsXlsx,
  type ParticipantExportRecord,
} from "../src/lib/participant-export";

const formulaLikeName = '=HYPERLINK("https://example.test","Buka")';
const record: ParticipantExportRecord = {
  id: "0123456789abcdef0123456789abcdef",
  nama_ortu: "Siti Aminah",
  status_ortu: "ibu",
  nama_anak: formulaLikeName,
  jenis_kelamin: "putri",
  sekolah_asal: "TAUD Griya Qur'an",
  bukti_transfer_mime: "application/pdf",
  tanggal_lahir_anak: "2021-01-05",
  umur_terhitung_bulan: 73,
  status_eligibility: "eligible",
  provinsi_nama: "Jawa Barat",
  kabupaten_nama: "Kota Bandung",
  kecamatan_nama: "Sukasari",
  desa_nama: "Sukarasa",
  no_hp_wa: "6281234567890",
  email: "amina@example.test",
  konfirmasi_data: 1,
  konfirmasi_bukti_transfer: 1,
  konfirmasi_ketentuan_biaya: 1,
  created_at: "2027-02-02T10:30:00.000Z",
};

test("individual PDF has a valid PDF signature and contains only form data, not proof bytes", async () => {
  const pdfBytes = await generateParticipantPdf(record);
  expect(new TextDecoder().decode(pdfBytes.subarray(0, 5))).toBe("%PDF-");
  const document = await PDFDocument.load(pdfBytes);
  expect(document.getPageCount()).toBeGreaterThan(0);
  expect(Buffer.from(pdfBytes).toString("latin1")).not.toContain("PAYMENT_PROOF_BYTES_ONLY");
});

test("individual Excel exports readable participant fields as literal string cells", async () => {
  const bytes = await generateParticipantXlsx(record);
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.getWorksheet("Data Peserta");
  expect(worksheet).toBeDefined();
  expect(worksheet!.getCell("A4").value).toBe("Nama calon santri");
  expect(worksheet!.getCell("B4").value).toBe(formulaLikeName);
  expect(worksheet!.getCell("B4").type).toBe(ExcelJS.ValueType.String);
  const cells: string[] = [];
  worksheet!.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value ?? ""))));
  for (const value of [
    "ID pendaftaran", record.id, "Jenis kelamin", "Putri", "Sekolah asal", record.sekolah_asal!,
    "Tanggal lahir", "05/01/2021", "Umur saat mendaftar", "6 tahun 1 bulan", "Memenuhi kriteria",
    record.nama_ortu, "Ibu", record.no_hp_wa, record.email, record.provinsi_nama, record.kabupaten_nama,
    record.kecamatan_nama, record.desa_nama, "Disetujui", "Dikonfirmasi", "Berkas terunggah (diunduh terpisah)",
    "02/02/2027 17:30 WIB",
  ]) expect(cells).toContain(value);
  expect(worksheet!.getColumn(1).values).toContain("Persetujuan ketentuan biaya");
});

test("bulk Excel has one participant per row and keeps formula-like names as text", async () => {
  const second = { ...record, id: "fedcba9876543210fedcba9876543210", nama_anak: "Ahmad" };
  const bytes = await generateParticipantsXlsx([record, second]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.getWorksheet("Data Pendaftar");
  expect(worksheet).toBeDefined();
  expect(worksheet!.rowCount).toBe(3);
  expect(worksheet!.getCell("B2").value).toBe(formulaLikeName);
  expect(worksheet!.getCell("B2").type).toBe(ExcelJS.ValueType.String);
  expect(worksheet!.getCell("B3").value).toBe("Ahmad");
  expect(worksheet!.getCell("Q2").value).toBe("Dikonfirmasi");
});
