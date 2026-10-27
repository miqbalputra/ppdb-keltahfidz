import ExcelJS from 'exceljs';
import type { WaitinglistReport } from './waitinglist-report';
import type { WaitinglistFilterQuery } from './waitinglist-filters';

export async function generateReportXlsx(report: WaitinglistReport, query: WaitinglistFilterQuery): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SPSB · Griya Qur’an Tunas Ilmu';
  const sheet = (name: string, headers: string[], rows: Array<Array<string | number>>) => {
    const ws = workbook.addWorksheet(name);
    ws.columns = headers.map(header => ({ header, width: 34 }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C4E42' } };
    for (const values of rows) {
      ws.addRow(values).eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true }; if (typeof cell.value === 'string') cell.numFmt = '@'; });
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  };
  sheet('Cakupan', ['Informasi', 'Nilai'], [
    ['Laporan', 'Pendaftaran SPSB 2027'], ['Status data', report.scope],
    ['Dibuat (WIB)', new Date(report.generatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })],
    ['Periode', report.registrationPeriod.label], ...Object.entries(query).filter(([, value]) => value).map(([key, value]) => [key, String(value)]),
    ['Catatan', 'Kelayakan dan usia merupakan snapshot saat daftar; lampiran bukan pembayaran terverifikasi. Persentase menggunakan total sesuai filter.'],
  ]);
  sheet('Ringkasan', ['Indikator sesuai filter', 'Jumlah'], [['Total', report.total], ['Hari ini', report.recent.today], ['7 hari terakhir', report.recent.week], ['30 hari terakhir', report.recent.month], ['Peserta dengan kekosongan', report.completeness.any]]);
  sheet('Tren', [`Awal bucket (${report.trend.interval})`, 'Jumlah'], report.trend.buckets.map(row => [row.date, row.total]));
  const names: Record<string, string> = { provinsi: 'Provinsi', kabupaten: 'Kabupaten', kecamatan: 'Kecamatan', sekolah: 'Sekolah', usia: 'Usia Tercatat', orangTua: 'Orang Tua', gender: 'Jenis Kelamin', eligibility: 'Kelayakan Saat Daftar' };
  for (const [key, rows] of Object.entries(report.breakdowns)) sheet(names[key] ?? key, ['Kategori', 'Jumlah', 'Persentase (%)'], rows.map(row => [row.label, row.total, row.percent]));
  sheet('Kelengkapan', ['Pencatatan yang belum lengkap', 'Jumlah', 'Persentase (%)'], report.completeness.fields.map(row => [row.label, row.total, row.percent]));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
