import ExcelJS from "exceljs";
import { PDFDocument, PageSizes, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface ParticipantExportRecord {
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
}

interface ExportField {
  key: keyof ParticipantExportRecord;
  label: string;
  value: (record: ParticipantExportRecord) => string;
}

const ageLabel = (months: number): string => {
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
  : "Belum memenuhi kriteria";

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
];

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

export async function generateParticipantsXlsx(records: ParticipantExportRecord[]): Promise<Uint8Array> {
  const workbook = makeWorkbook("Daftar pendaftar SPSB 2027");
  const worksheet = workbook.addWorksheet("Data Pendaftar");
  worksheet.columns = fields.map((field) => ({ header: field.label, width: Math.min(Math.max(field.label.length + 3, 18), 34) }));
  const header = worksheet.getRow(1);
  styleHeader(header);
  setTextRows(worksheet, records.map(valuesFor));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  if (fields.length) worksheet.autoFilter = { from: "A1", to: `${columnName(fields.length)}1` };
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

function pdfSafeText(value: string, font: PDFFont): string {
  let safe = "";
  for (const character of value.replace(/[\r\n\t]+/g, " ")) {
    try {
      font.encodeText(character);
      safe += character;
    } catch {
      const normalized = character.normalize("NFKD").replace(/\p{Mark}/gu, "");
      try {
        font.encodeText(normalized);
        safe += normalized;
      } catch {
        safe += "?";
      }
    }
  }
  return safe;
}

function wrapPdfText(value: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const text = pdfSafeText(value, font).replace(/\s+/g, " ").trim();
  if (!text) return ["—"];
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const character of word) {
      const chunk = line + character;
      if (font.widthOfTextAtSize(chunk, size) > maxWidth && line) {
        lines.push(line);
        line = character;
      } else {
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function generateParticipantPdf(record: ParticipantExportRecord): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const margin = 48;
  const pageWidth = PageSizes.A4[0];
  const pageHeight = PageSizes.A4[1];
  let page = document.addPage(PageSizes.A4);
  const pages: PDFPage[] = [page];
  let cursorY = 0;

  const drawPageHeader = (): void => {
    cursorY = pageHeight - margin;
    page.drawText("DATA PENDAFTARAN SPSB 2027", {
      x: margin,
      y: cursorY,
      size: 16,
      font: bold,
      color: rgb(0.235, 0.306, 0.259),
    });
    cursorY -= 21;
    page.drawText("Kelompok Tahfidz Griya Qur’an · Tunas Ilmu", {
      x: margin,
      y: cursorY,
      size: 10,
      font: regular,
      color: rgb(0.31, 0.42, 0.34),
    });
    cursorY -= 17;
    page.drawLine({
      start: { x: margin, y: cursorY },
      end: { x: pageWidth - margin, y: cursorY },
      thickness: 1,
      color: rgb(0.83, 0.87, 0.83),
    });
    cursorY -= 22;
  };
  const newPage = (): void => {
    page = document.addPage(PageSizes.A4);
    pages.push(page);
    drawPageHeader();
  };

  drawPageHeader();
  const valueWidth = pageWidth - margin * 2;
  for (const field of fields) {
    const label = pdfSafeText(field.label, bold);
    const lines = wrapPdfText(field.value(record), regular, 10, valueWidth);
    const neededHeight = 12 + lines.length * 13 + 9;
    if (cursorY - neededHeight < margin + 18) newPage();
    page.drawText(label, {
      x: margin,
      y: cursorY,
      size: 8,
      font: bold,
      color: rgb(0.40, 0.43, 0.40),
    });
    cursorY -= 13;
    for (const line of lines) {
      page.drawText(line, {
        x: margin,
        y: cursorY,
        size: 10,
        font: regular,
        color: rgb(0.18, 0.19, 0.18),
        maxWidth: valueWidth,
      });
      cursorY -= 13;
    }
    cursorY -= 9;
  }

  for (const [index, currentPage] of pages.entries()) {
    currentPage.drawText(`Dokumen panitia · ID ${pdfSafeText(record.id, regular)} · ${index + 1}/${pages.length}`, {
      x: margin,
      y: 24,
      size: 8,
      font: regular,
      color: rgb(0.45, 0.47, 0.45),
    });
  }
  return document.save();
}
