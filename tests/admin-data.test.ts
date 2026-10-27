import { expect, test } from 'bun:test';
import ExcelJS from 'exceljs';
process.env.DATA_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const { encryptSensitiveRecord, decryptSensitiveRecord } = await import('../src/lib/encryption');
const { matchesEncryptedWaitinglist, validateWaitinglistFilterQuery, sortWaitinglist } = await import('../src/lib/waitinglist-filters');
const { buildWaitinglistReport } = await import('../src/lib/waitinglist-report');
const { generateReportXlsx } = await import('../src/lib/report-export');
const now = new Date('2027-02-04T17:00:00Z'); // 5 February WIB
function row(index: number, overrides: Record<string, unknown> = {}) {
  return encryptSensitiveRecord({
    id: String(index).padStart(32, '0'), nama_anak: `Santri ${index}`, nama_ortu: 'Ortu privat',
    no_hp_wa: '6281234567890', email: 'privat@example.test', desa_nama: 'Desa',
    provinsi_nama: 'Jawa Barat', kabupaten_nama: 'Bandung', kecamatan_nama: 'Sukasari',
    status_ortu: 'ibu', jenis_kelamin: 'putri' as string | null, sekolah_asal: 'TK Mawar' as string | null,
    tanggal_lahir_anak: '2020-01-01', umur_terhitung_bulan: '84', status_eligibility: 'eligible',
    bukti_transfer_mime: 'image/png' as string | null, konfirmasi_data: 1,
    konfirmasi_bukti_transfer: 1 as number | null, konfirmasi_ketentuan_biaya: 1 as number | null,
    created_at: '2027-02-04T17:00:00.000Z', ...overrides,
  });
}
test('extended encrypted filters support ID, school, hierarchical regions, missing data and recorded age', () => {
  const participant = row(1);
  for (const q of ['00001', 'mawar', 'bandung', 'jawa barat']) expect(matchesEncryptedWaitinglist(participant, { q })).toBe(true);
  expect(matchesEncryptedWaitinglist(participant, { provinsi: 'Jawa Barat', kabupaten: 'Bandung', sekolah: 'tk mawar', age_group: '7to8' })).toBe(true);
  expect(matchesEncryptedWaitinglist(participant, { kabupaten: 'Kabupaten lain' })).toBe(false);
  expect(matchesEncryptedWaitinglist(participant, { missing: 'any' })).toBe(false);
  const legacy = row(2, { jenis_kelamin: null, sekolah_asal: '  ', umur_terhitung_bulan: '', bukti_transfer_mime: null, konfirmasi_bukti_transfer: null });
  for (const missing of ['gender', 'school', 'proof', 'consent', 'any']) expect(matchesEncryptedWaitinglist(legacy, { missing })).toBe(true);
  expect(matchesEncryptedWaitinglist(legacy, { age_group: 'unknown' })).toBe(true);
  for (const invalid of [{ page_size: '1000' }, { sort: 'email' }, { view: 'everything' }, { missing: 'paid' }, { trend: 'bad' }]) expect(validateWaitinglistFilterQuery(invalid)).not.toBeNull();
});
test('literal ciphertext-like user text is decoded once across filter, report and export projection', () => {
  const participant = row(9, { sekolah_asal: 'enc:v2:literal user text' });
  expect(matchesEncryptedWaitinglist(participant, { sekolah: 'enc:v2:literal user text' })).toBe(true);
  expect(buildWaitinglistReport([participant], {}, now).breakdowns.sekolah![0]!.label).toBe('enc:v2:literal user text');
  expect(decryptSensitiveRecord(participant).sekolah_asal).toBe('enc:v2:literal user text');
});
test('sorting is deterministic and leaves original input unchanged', () => {
  const rows = [row(2, { nama_anak: 'Zahra', umur_terhitung_bulan: '96' }), row(1, { nama_anak: 'Amina', umur_terhitung_bulan: '72', created_at: '2027-02-03T17:00:00.000Z' }), row(3, { nama_anak: 'Amina', umur_terhitung_bulan: '84' })];
  const ids = (sort: string) => sortWaitinglist(rows, sort).map(row => Number(row.id));
  expect(ids('newest')).toEqual([2, 3, 1]); expect(ids('oldest')).toEqual([1, 2, 3]);
  expect(ids('name')).toEqual([1, 3, 2]); expect(ids('age')).toEqual([1, 3, 2]);
  expect(rows.map(row => Number(row.id))).toEqual([2, 1, 3]);
});
test('analytics has explicit numeric results, deduplicated missing participants and WIB day boundaries', () => {
  const rows = [row(1), row(2, { created_at: '2027-02-04T16:59:59.000Z', jenis_kelamin: null, sekolah_asal: null, konfirmasi_ketentuan_biaya: null }), row(3, { created_at: '2027-01-01T00:00:00.000Z', kabupaten_nama: 'Kabupaten lain', umur_terhitung_bulan: '71', status_eligibility: 'not_eligible' })];
  const report = buildWaitinglistReport(rows, {}, now);
  expect(report.recent).toEqual({ today: 1, week: 2, month: 2 });
  expect(report.completeness.any).toBe(1);
  expect(report.completeness.fields.map(row => row.total)).toEqual([1, 1, 0, 1]);
  expect(report.breakdowns.kecamatan).toHaveLength(2);
  expect(report.breakdowns.usia!.map(row => row.total).sort()).toEqual([1, 2]);
  for (const rows of Object.values(report.breakdowns)) expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(3);
  for (const value of report.breakdowns.kecamatan!) expect(value.filter?.kabupaten).toBeTruthy();
  for (const secret of ['Ortu privat', 'privat@example.test', '6281234567890', 'Santri 1']) expect(JSON.stringify(report)).not.toContain(secret);
  const filtered = buildWaitinglistReport(rows, { missing: 'school', tanggal_daftar_mulai: '2027-02-04', tanggal_daftar_sampai: '2027-02-04' }, now);
  expect(filtered.total).toBe(1); expect(filtered.trend.buckets).toEqual([{ date: '2027-02-04', total: 1 }]);
});
test('one-sided and long trend ranges preserve counts, fill zero buckets and stay bounded', () => {
  const rows = [row(1, { created_at: '2020-01-01T00:00:00.000Z' }), row(2, { created_at: '2027-02-04T17:00:00.000Z' })];
  for (const query of [{ tanggal_daftar_sampai: '2027-02-05' }, { tanggal_daftar_mulai: '2020-01-01', tanggal_daftar_sampai: '2027-02-05', trend: 'daily' }, { tanggal_daftar_mulai: '1900-01-01', tanggal_daftar_sampai: '2027-02-05' }]) {
    const report = buildWaitinglistReport(rows, query, now);
    expect(report.trend.buckets.length).toBeLessThanOrEqual(400);
    expect(report.trend.buckets.reduce((sum, row) => sum + row.total, 0)).toBe(2);
    expect(report.trend.buckets.some(row => row.total === 0)).toBe(true);
  }
  const empty = buildWaitinglistReport([], {}, now);
  expect(empty.total).toBe(0); expect(empty.completeness.fields.every(row => row.percent === 0)).toBe(true);
  expect(empty.trend.buckets).toHaveLength(30);
  const future = buildWaitinglistReport([row(1, { created_at: '2028-01-01T00:00:00.000Z' })], { tanggal_daftar_mulai: '2028-01-01' }, now);
  expect(future.trend.buckets.reduce((sum, row) => sum + row.total, 0)).toBe(1);
});
test('aggregate workbook reflects filtered report without participant identities or spreadsheet formulas', async () => {
  const report = buildWaitinglistReport([row(1, { sekolah_asal: '=HYPERLINK("bad")' }), row(2, { sekolah_asal: null })], { missing: 'school', view: 'archived' }, now);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await generateReportXlsx(report, { missing: 'school', view: 'archived' })) as never);
  expect(workbook.getWorksheet('Ringkasan')!.getCell('B2').value).toBe(1);
  expect(workbook.getWorksheet('Cakupan')!.getCell('B3').value).toBe('Arsip');
  expect(workbook.getWorksheet('Sekolah')!.getCell('A2').value).toBe('Belum tercatat');
  const all = new ExcelJS.Workbook();
  await all.xlsx.load(Buffer.from(await generateReportXlsx(buildWaitinglistReport([row(1, { sekolah_asal: '=SUM(1)' })], {}, now), {})) as never);
  expect(all.getWorksheet('Sekolah')!.getCell('A2').type).toBe(ExcelJS.ValueType.String);
  expect(all.getWorksheet('Sekolah')!.getCell('A2').value).toBe('=SUM(1)');
  const cells: string[] = [];
  workbook.eachSheet(sheet => sheet.eachRow(row => row.eachCell(cell => cells.push(String(cell.value)))));
  expect(cells.join('|')).not.toContain('privat@example.test');
});
