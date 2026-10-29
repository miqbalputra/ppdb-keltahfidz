import ExcelJS from 'exceljs';
import type { WaitinglistReport } from './waitinglist-report';
import type { WaitinglistFilterQuery } from './waitinglist-filters';
import { PdfLayout } from './pdf-layout';
import { describeFilters } from './waitinglist-filters';
import { trendIntervalLabel } from './payment-report';

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
    ['Periode', report.registrationPeriod.label], ['Filter', describeFilters(query)],
    ['Catatan', 'Kelayakan dan usia merupakan snapshot saat daftar; lampiran bukan pembayaran terverifikasi. Persentase menggunakan total sesuai filter.'],
  ]);
  sheet('Ringkasan', ['Indikator sesuai filter', 'Jumlah'], [['Total', report.total], ['Hari ini', report.recent.today], ['7 hari terakhir', report.recent.week], ['30 hari terakhir', report.recent.month], ['Peserta dengan kekosongan', report.completeness.any]]);
  sheet('Tren', [`Awal bucket (${report.trend.interval})`, 'Jumlah'], report.trend.buckets.map(row => [row.date, row.total]));
  const names: Record<string, string> = { provinsi: 'Provinsi', kabupaten: 'Kabupaten', kecamatan: 'Kecamatan', sekolah: 'Sekolah', usia: 'Usia Tercatat', orangTua: 'Orang Tua', gender: 'Jenis Kelamin', eligibility: 'Kelayakan Saat Daftar' };
  for (const [key, rows] of Object.entries(report.breakdowns)) sheet(names[key] ?? key, ['Kategori', 'Jumlah', 'Persentase (%)'], rows.map(row => [row.label, row.total, row.percent]));
  sheet('Kelengkapan', ['Pencatatan yang belum lengkap', 'Jumlah', 'Persentase (%)'], report.completeness.fields.map(row => [row.label, row.total, row.percent]));
  const payment = report.payments;
  sheet('Pembayaran', ['Indikator', 'Nilai'], [['Belum diperiksa', payment.pending], ['Terverifikasi', payment.verified],
    ['Perlu perbaikan', payment.needs_correction], ['Tanpa metadata bukti', payment.withoutProof], ['Nominal tervalidasi (Rp)', payment.verifiedAmount], ['Terverifikasi (%)', payment.verifiedPercent]]);
  sheet('Tren Pembayaran', ['Tanggal bucket', 'Pembayaran tervalidasi', 'Nominal (Rp)'], payment.trend.buckets.map(row => [row.date, row.total, row.amount]));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export async function generateReportPdf(report: WaitinglistReport, query: WaitinglistFilterQuery) {
  const pdf = await PdfLayout.create('Laporan Statistik SPSB 2027', false, report.generatedAt);
  pdf.paragraph(`Cakupan: ${report.scope} | Periode pendaftaran: ${report.registrationPeriod.label}`);
  pdf.paragraph('Filter: ' + describeFilters(query));
  pdf.section('RINGKASAN PENDAFTARAN');
  pdf.table(['Indikator', 'Jumlah'], [['Pendaftar sesuai filter', report.total], ['Hari ini (WIB)', report.recent.today], ['7 hari terakhir', report.recent.week], ['30 hari terakhir', report.recent.month]]);
  pdf.section('PEMERIKSAAN PEMBAYARAN');
  pdf.table(['Indikator', 'Nilai'], [['Belum diperiksa', report.payments.pending], ['Terverifikasi', report.payments.verified],
    ['Perlu perbaikan', report.payments.needs_correction], ['Tanpa metadata bukti', report.payments.withoutProof],
    ['Nominal tervalidasi', 'Rp' + report.payments.verifiedAmount.toLocaleString('id-ID')], ['Persentase terverifikasi', `${report.payments.verifiedPercent}%`]]);
  pdf.paragraph('Nominal tervalidasi hanya mencakup pembayaran berstatus Terverifikasi dengan biaya tetap Rp150.000 per peserta. Cakupan aktif/arsip tercantum di atas.');
  pdf.section(`TREN PENDAFTARAN (${trendIntervalLabel(report.trend.interval)})`);
  pdf.table(['Awal bucket', 'Pendaftar'], report.trend.buckets.map(row => [row.date, row.total]));
  pdf.section(`TREN PEMBAYARAN (${trendIntervalLabel(report.payments.trend.interval)})`);
  pdf.paragraph('Periode tanggal pembayaran: ' + report.payments.trend.start + ' sampai ' + report.payments.trend.end);
  pdf.table(['Awal bucket', 'Pembayaran terverifikasi', 'Nominal (Rp)'], report.payments.trend.buckets.map(row => [row.date, row.total, row.amount.toLocaleString('id-ID')]));
  const names: Record<string, string> = { provinsi: 'Provinsi', kabupaten: 'Kabupaten/kota', kecamatan: 'Kecamatan', sekolah: 'Sekolah asal', usia: 'Usia tercatat', orangTua: 'Hubungan orang tua', gender: 'Jenis kelamin', eligibility: 'Kelayakan tercatat' };
  for (const [key, rows] of Object.entries(report.breakdowns)) {
    pdf.section(names[key] || key); pdf.table(['Kategori', 'Peserta', 'Persentase'], rows.map(row => [row.label, row.total, `${row.percent}%`]), [3, 1, 1]);
  }
  pdf.section('KELENGKAPAN PENCATATAN');
  pdf.table(['Data yang belum tercatat', 'Peserta', 'Persentase'], report.completeness.fields.map(row => [row.label, row.total, `${row.percent}%`]), [3, 1, 1]);
  pdf.paragraph('Usia dan kelayakan merupakan nilai yang tercatat, bukan hasil seleksi. Metadata lampiran tidak menjamin berkas tersedia.');
  return pdf.save();
}
