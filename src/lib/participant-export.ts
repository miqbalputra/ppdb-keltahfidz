import ExcelJS from "exceljs";
import { PdfLayout } from "./pdf-layout";
import { paymentLabel, REGISTRATION_FEE } from "./payment-report";

export interface ParticipantExportRecord {
  payment_status?: string;
  payment_date?: string | null;
  payment_reviewed_at?: string | null;
  payment_reviewer?: string | null;
  payment_note?: string | null;
  id: string;
  nama_ortu: string;
  status_ortu: string;
  nama_anak: string;
  jenis_kelamin: string | null;
  sekolah_asal: string | null;
  bukti_transfer_mime: string | null;
  tanggal_lahir_anak: string;
  umur_terhitung_bulan: number;
  status_eligibility: string;
  provinsi_nama: string;
  kabupaten_nama: string;
  kecamatan_nama: string;
  desa_nama: string;
  no_hp_wa: string;
  email: string;
  konfirmasi_data: number;
  konfirmasi_bukti_transfer: number | null;
  konfirmasi_ketentuan_biaya: number | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
}

interface ExportField {
  key: keyof ParticipantExportRecord;
  label: string;
  value: (record: ParticipantExportRecord) => string;
}

const ageLabel = (months: number): string => {
  if (!Number.isFinite(months) || months < 0) return 'Belum tercatat';
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths ? `${years} tahun ${remainingMonths} bulan` : `${years} tahun`;
};

const dateLabel = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-");
  return year && month && day ? `${day}/${month}/${year}` : isoDate;
};

const eligibilityLabel = (status: string): string => status === "eligible"
  ? "Memenuhi kriteria"
  : status === 'not_eligible' ? "Belum memenuhi kriteria" : 'Belum tercatat';

const registrationDateLabel = (isoTimestamp: string): string => {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}/${value("month")}/${value("year")} ${value("hour")}:${value("minute")} WIB`;
};

const fields: ExportField[] = [
  { key: 'payment_status', label: 'Status pembayaran', value: r => paymentLabel(r.payment_status) },
  { key: 'payment_date', label: 'Tanggal pembayaran', value: r => r.payment_date ? dateLabel(r.payment_date) : '-' },
  { key: 'payment_status', label: 'Nominal tervalidasi (Rp)', value: r => r.payment_status === 'verified' ? String(REGISTRATION_FEE) : '0' },
  { key: 'payment_reviewer', label: 'Pemeriksa pembayaran', value: r => r.payment_reviewer || '-' },
  { key: 'payment_reviewed_at', label: 'Waktu pemeriksaan', value: r => r.payment_reviewed_at ? registrationDateLabel(r.payment_reviewed_at) : '-' },
  { key: 'payment_note', label: 'Catatan pemeriksaan', value: r => r.payment_note || '-' },
  { key: "id", label: "ID pendaftaran", value: (record) => record.id },
  { key: "nama_anak", label: "Nama calon santri", value: (record) => record.nama_anak },
  {
    key: "jenis_kelamin",
    label: "Jenis kelamin",
    value: (record) => record.jenis_kelamin === "putra" ? "Putra" : record.jenis_kelamin === "putri" ? "Putri" : "Belum dicatat",
  },
  { key: "sekolah_asal", label: "Sekolah asal", value: (record) => record.sekolah_asal || "Belum dicatat" },
  { key: "tanggal_lahir_anak", label: "Tanggal lahir", value: (record) => dateLabel(record.tanggal_lahir_anak) },
  { key: "umur_terhitung_bulan", label: "Umur saat mendaftar", value: (record) => ageLabel(record.umur_terhitung_bulan) },
  { key: "status_eligibility", label: "Status kelayakan usia", value: (record) => eligibilityLabel(record.status_eligibility) },
  { key: "nama_ortu", label: "Nama orang tua/wali", value: (record) => record.nama_ortu },
  { key: "status_ortu", label: "Hubungan orang tua/wali", value: (record) => record.status_ortu === "bapak" ? "Bapak" : record.status_ortu === "ibu" ? "Ibu" : record.status_ortu },
  { key: "no_hp_wa", label: "Nomor WhatsApp", value: (record) => record.no_hp_wa },
  { key: "email", label: "Email", value: (record) => record.email },
  { key: "provinsi_nama", label: "Provinsi", value: (record) => record.provinsi_nama },
  { key: "kabupaten_nama", label: "Kabupaten/kota", value: (record) => record.kabupaten_nama },
  { key: "kecamatan_nama", label: "Kecamatan", value: (record) => record.kecamatan_nama },
  { key: "desa_nama", label: "Desa/kelurahan", value: (record) => record.desa_nama },
  { key: "konfirmasi_data", label: "Persetujuan penggunaan data", value: (record) => record.konfirmasi_data === 1 ? "Disetujui" : "Belum dicatat" },
  { key: "konfirmasi_bukti_transfer", label: "Konfirmasi bukti transfer", value: (record) => record.konfirmasi_bukti_transfer === 1 ? "Dikonfirmasi" : "Belum dicatat" },
  { key: "bukti_transfer_mime", label: "Status bukti transfer", value: (record) => record.bukti_transfer_mime ? "Berkas terunggah (diunduh terpisah)" : "Belum ada berkas" },
  { key: "konfirmasi_ketentuan_biaya", label: "Persetujuan ketentuan biaya", value: (record) => record.konfirmasi_ketentuan_biaya === 1 ? "Disetujui" : "Belum dicatat" },
  { key: "created_at", label: "Tanggal pendaftaran", value: (record) => registrationDateLabel(record.created_at) },
  { key: 'deleted_at', label: 'Status data', value: record => record.deleted_at ? 'Arsip' : 'Aktif' },
  { key: 'deleted_at', label: 'Waktu arsip', value: record => record.deleted_at ? registrationDateLabel(record.deleted_at) : '' },
  { key: 'deleted_by', label: 'Diarsipkan oleh', value: record => record.deleted_by || '' },
];

fields.push(...fields.splice(0, 6));

function valuesFor(record: ParticipantExportRecord): string[] {
  return fields.map((field) => String(field.value(record)));
}

function makeWorkbook(title: string): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Griya Qur’an Tunas Ilmu";
  workbook.subject = "Data pendaftaran SPSB 2027";
  workbook.title = title;
  workbook.created = new Date();
  return workbook;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3C4E42" } };
  row.alignment = { vertical: "middle", wrapText: true };
}

function setTextRows(worksheet: ExcelJS.Worksheet, rows: string[][]): void {
  for (const rowValues of rows) {
    const row = worksheet.addRow(rowValues);
    row.eachCell((cell) => {
      cell.numFmt = "@";
      cell.alignment = { vertical: "top", wrapText: true };
      // Plain strings remain string cells; only explicit formula objects can create formulas.
      if (typeof cell.value !== "string") cell.value = String(cell.value ?? "");
    });
  }
}

export async function generateParticipantXlsx(record: ParticipantExportRecord): Promise<Uint8Array> {
  const workbook = makeWorkbook(`Data peserta ${record.id}`);
  const worksheet = workbook.addWorksheet("Data Peserta");
  worksheet.columns = [{ width: 32 }, { width: 64 }];
  worksheet.addRow(["Data pendaftaran SPSB 2027", "Griya Qur’an Tunas Ilmu"]);
  worksheet.mergeCells("A1:B1");
  styleHeader(worksheet.getRow(1));
  worksheet.addRow(["Informasi", "Data"]);
  styleHeader(worksheet.getRow(2));
  setTextRows(worksheet, fields.map((field) => [field.label, field.value(record)]));
  worksheet.views = [{ state: "frozen", ySplit: 2 }];
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function generateParticipantsXlsx(records: ParticipantExportRecord[], context: ExportContext = {}): Promise<Uint8Array> {
  const workbook = makeWorkbook("Daftar pendaftar SPSB 2027");
  const worksheet = workbook.addWorksheet("Data Pendaftar");
  worksheet.columns = fields.map((field) => ({ header: field.label, width: Math.min(Math.max(field.label.length + 3, 18), 34) }));
  const header = worksheet.getRow(1);
  styleHeader(header);
  setTextRows(worksheet, records.map(valuesFor));
  const amountColumn = fields.findIndex(field => field.label === 'Nominal tervalidasi (Rp)') + 1;
  records.forEach((record, i) => { const cell = worksheet.getRow(i + 2).getCell(amountColumn); cell.value = record.payment_status === 'verified' ? REGISTRATION_FEE : 0; cell.numFmt = '#,##0'; });
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  if (fields.length) worksheet.autoFilter = { from: "A1", to: `${columnName(fields.length)}1` };
  const metadata = workbook.addWorksheet('Cakupan'); metadata.columns = [{ width: 26 }, { width: 90 }];
  metadata.addRows([['Laporan', 'Data pendaftar SPSB 2027'], ['Status data', context.scope || 'Aktif'], ['Filter', context.filters || 'Tanpa filter tambahan'],
    ['Dibuat (WIB)', registrationDateLabel(context.generatedAt || new Date().toISOString())], ['Jumlah peserta', records.length]]);
  metadata.eachRow(row => row.alignment = { wrapText: true, vertical: 'top' });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function generatePaymentsXlsx(records: ParticipantExportRecord[], context: ExportContext = {}) {
  const workbook = makeWorkbook('Rekap pemeriksaan pembayaran SPSB 2027');
  const ws = workbook.addWorksheet('Pembayaran');
  ws.columns = ['ID', 'Calon santri', 'Orang tua', 'WhatsApp', 'Email', 'Status data', 'Pembayaran', 'Biaya (Rp)', 'Nominal tervalidasi (Rp)', 'Tanggal bayar', 'Pemeriksa', 'Waktu pemeriksaan WIB', 'Catatan'].map(header => ({ header, width: 25 }));
  styleHeader(ws.getRow(1));
  records.forEach(record => {
    const row = ws.addRow([record.id, record.nama_anak, record.nama_ortu, record.no_hp_wa, record.email, record.deleted_at ? 'Arsip' : 'Aktif',
      paymentLabel(record.payment_status), REGISTRATION_FEE, record.payment_status === 'verified' ? REGISTRATION_FEE : 0,
      record.payment_date || '', record.payment_reviewer || '', record.payment_reviewed_at ? registrationDateLabel(record.payment_reviewed_at) : '', record.payment_note || '']);
    row.eachCell(cell => { cell.alignment = { wrapText: true, vertical: 'top' }; cell.numFmt = typeof cell.value === 'number' ? '#,##0' : '@'; });
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }]; ws.autoFilter = 'A1:M1';
  const metadata = workbook.addWorksheet('Cakupan'); metadata.columns = [{ width: 28 }, { width: 90 }];
  metadata.addRows([['Laporan', 'Pemeriksaan pembayaran SPSB 2027'], ['Status data', context.scope || 'Aktif dan arsip'],
    ['Filter', context.filters || 'Tanpa filter tambahan'], ['Dibuat (WIB)', registrationDateLabel(context.generatedAt || new Date().toISOString())],
    ['Jumlah peserta', records.length], ['Nominal tervalidasi (Rp)', records.filter(row => row.payment_status === 'verified').length * REGISTRATION_FEE]]);
  metadata.eachRow(row => row.alignment = { wrapText: true, vertical: 'top' });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function columnName(column: number): string {
  let current = column;
  let name = "";
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + current % 26) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

export async function generateParticipantPdf(record: ParticipantExportRecord): Promise<Uint8Array> {
  const pdf = await PdfLayout.create('Formulir Pendaftaran Santri');
  pdf.paragraph('ID pendaftaran: ' + record.id);
  pdf.paragraph('Status data: ' + (record.deleted_at ? 'Arsip' : 'Aktif') + ' | Terdaftar: ' + registrationDateLabel(record.created_at));
  const group = (title: string, keys: string[]) => { pdf.section(title); pdf.fields(fields.filter(f => keys.includes(f.key)).map(f => [f.label, f.label === 'Nominal tervalidasi (Rp)' ? Number(f.value(record)).toLocaleString('id-ID') : f.value(record)])); };
  group('IDENTITAS CALON SANTRI', ['nama_anak', 'jenis_kelamin', 'sekolah_asal', 'tanggal_lahir_anak', 'umur_terhitung_bulan', 'status_eligibility']);
  group('ORANG TUA DAN DOMISILI', ['nama_ortu', 'status_ortu', 'no_hp_wa', 'email', 'provinsi_nama', 'kabupaten_nama', 'kecamatan_nama', 'desa_nama']);
  group('PERSETUJUAN DAN LAMPIRAN', ['konfirmasi_data', 'konfirmasi_bukti_transfer', 'konfirmasi_ketentuan_biaya', 'bukti_transfer_mime']);
  group('PEMERIKSAAN PEMBAYARAN', ['payment_status', 'payment_date', 'payment_reviewer', 'payment_reviewed_at', 'payment_note']);
  pdf.paragraph('Penerimaan formulir dan verifikasi pembayaran tidak menentukan hasil seleksi. Bukti transfer tersedia sebagai lampiran terpisah.');
  return pdf.save();
}
export interface ExportContext { scope?: string; filters?: string; generatedAt?: string }
export async function generateParticipantsPdf(records: ParticipantExportRecord[], context: ExportContext = {}, paymentOnly = false): Promise<Uint8Array> {
  const pdf = await PdfLayout.create(paymentOnly ? 'Rekap Pemeriksaan Pembayaran' : 'Rekap Pendaftar SPSB 2027', true, context.generatedAt);
  pdf.paragraph('Cakupan: ' + (context.scope || 'Aktif') + ' | Total: ' + records.length + ' peserta');
  pdf.paragraph('Filter: ' + (context.filters || 'Tanpa filter'));
  if (paymentOnly) {
    pdf.paragraph('Biaya pendaftaran Rp150.000 | Nominal tervalidasi: Rp' + (records.filter(r => r.payment_status === 'verified').length * REGISTRATION_FEE).toLocaleString('id-ID'));
    pdf.table(['No.', 'Calon santri / orang tua', 'WhatsApp', 'Hasil pemeriksaan', 'Tanggal bayar', 'Pemeriksa / catatan'], records.map((r, i) => [i + 1, r.nama_anak + '\n' + r.nama_ortu, r.no_hp_wa, paymentLabel(r.payment_status), r.payment_date ? dateLabel(r.payment_date) : '-', (r.payment_reviewer || '-') + '\n' + (r.payment_note || '')]), [0.4, 2.1, 1.35, 1.4, 1, 2]);
  } else {
    pdf.table(['No.', 'Calon santri', 'Orang tua', 'WhatsApp', 'Kabupaten/kota', 'Tanggal daftar', 'Pembayaran'], records.map((r, i) => [i + 1, r.nama_anak + '\n' + (r.jenis_kelamin === 'putra' ? 'Putra' : r.jenis_kelamin === 'putri' ? 'Putri' : '-'), r.nama_ortu, r.no_hp_wa, r.kabupaten_nama, registrationDateLabel(r.created_at), paymentLabel(r.payment_status)]), [0.4, 1.8, 1.7, 1.35, 1.6, 1.4, 1.4]);
  }
  return pdf.save();
}
