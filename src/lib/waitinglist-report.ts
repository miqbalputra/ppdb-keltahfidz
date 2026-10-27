import { readStoredField } from './encryption';
import { matchesEncryptedWaitinglist, missingRecordFields, recordedAgeGroup, type EncryptedWaitinglistFilterRow, type WaitinglistFilterQuery } from './waitinglist-filters';

export interface EncryptedWaitinglistReportRow extends EncryptedWaitinglistFilterRow {
  kabupaten_nama: string;
  provinsi_nama: string;
  status_ortu?: string;
}
export interface Breakdown { label: string; total: number; percent: number; filter?: WaitinglistFilterQuery }
export interface WaitinglistReport {
  total: number;
  registrationPeriod: { start: string | null; end: string | null; label: string };
  daily: Array<{ date: string; total: number }>;
  gender: { putra: number; putri: number; unrecorded: number };
  eligibilityAtSubmission: { eligible: number; notEligible: number; unrecorded: number };
  topDistricts: Array<{ district: string; regency: string; province: string; total: number }>;
  generatedAt: string;
  scope: string;
  recent: { today: number; week: number; month: number };
  trend: { start: string; end: string; interval: string; buckets: Array<{ date: string; total: number }> };
  breakdowns: Record<string, Breakdown[]>;
  completeness: { any: number; fields: Breakdown[] };
}
function jakartaDate(timestamp: string): string {
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? new Date(time + 7 * 3600000).toISOString().slice(0, 10) : '';
}
function shift(date: string, days: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
function bucket(date: string, interval: string, yearStep = 1) {
  if (interval === 'yearly') return `${String(Math.floor(Number(date.slice(0, 4)) / yearStep) * yearStep).padStart(4, '0')}-01-01`;
  if (interval === 'monthly') return `${date.slice(0, 7)}-01`;
  if (interval === 'weekly') return shift(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  return date;
}
export function buildWaitinglistReport(rows: EncryptedWaitinglistReportRow[], query: WaitinglistFilterQuery, now = new Date()): WaitinglistReport {
  const filtered = rows.filter(row => matchesEncryptedWaitinglist(row, query));
  const total = filtered.length;
  const today = jakartaDate(now.toISOString());
  const startDate = query.tanggal_daftar_mulai ?? null;
  const endDate = query.tanggal_daftar_sampai ?? null;
  const dates = filtered.map(row => jakartaDate(row.created_at)).filter(Boolean).sort();
  const end = endDate ?? (startDate ? [startDate, today, dates.at(-1) || today].sort().at(-1)! : today);
  const start = startDate ?? (endDate ? (dates[0] && dates[0] < end ? dates[0] : shift(end, -29)) : shift(end, -29));
  const span = (Date.parse(end) - Date.parse(start)) / 86400000;
  // Explicit daily/weekly requests are coarsened rather than silently truncated.
  let interval = query.trend && query.trend !== 'auto' ? query.trend : span > 366 ? 'monthly' : span > 90 ? 'weekly' : 'daily';
  if (interval === 'daily' && span > 366) interval = 'weekly';
  if (interval === 'weekly' && span > 366 * 7) interval = 'monthly';
  if (interval === 'monthly' && span > 30 * 366) interval = 'yearly';
  const yearStep = Math.max(1, Math.ceil((Number(end.slice(0, 4)) - Number(start.slice(0, 4)) + 1) / 360));
  const counts = new Map<string, number>();
  const dayCounts = new Map<string, number>();
  const recent = { today: 0, week: 0, month: 0 };
  for (const date of dates) {
    if (date === today) recent.today++;
    if (date >= shift(today, -6) && date <= today) recent.week++;
    if (date >= shift(today, -29) && date <= today) recent.month++;
    if (date >= start && date <= end) counts.set(bucket(date, interval, yearStep), (counts.get(bucket(date, interval, yearStep)) ?? 0) + 1);
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
  }
  const buckets: WaitinglistReport['daily'] = [];
  for (let date = bucket(start, interval, yearStep); date <= end && buckets.length < 400;) {
    buckets.push({ date, total: counts.get(date) ?? 0 });
    date = interval === 'yearly' ? `${String(Number(date.slice(0, 4)) + yearStep).padStart(4, '0')}-01-01` : interval === 'monthly' ? new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1)).toISOString().slice(0, 10) : shift(date, interval === 'weekly' ? 7 : 1);
  }
  // Legacy daily series remains bounded for existing consumers; new UI uses trend.
  const daily: WaitinglistReport['daily'] = [];
  for (let date = span > 365 ? shift(end, -365) : start; date <= end && daily.length < 366; date = shift(date, 1)) daily.push({ date, total: dayCounts.get(date) ?? 0 });
  const gender = { putra: 0, putri: 0, unrecorded: 0 };
  const eligibilityAtSubmission = { eligible: 0, notEligible: 0, unrecorded: 0 };
  const districts = new Map<string, { district: string; regency: string; province: string; total: number }>();
  const maps = Object.fromEntries(['provinsi', 'kabupaten', 'kecamatan', 'sekolah', 'usia', 'orangTua', 'gender', 'eligibility'].map(key => [key, new Map<string, Breakdown>()]));
  const add = (kind: string, key: string, label: string, filter?: WaitinglistFilterQuery) => {
    const map = maps[kind]!;
    const value = map.get(key) ?? { label, total: 0, percent: 0, filter };
    value.total++; map.set(key, value);
  };
  const missingCounts = { gender: 0, school: 0, proof: 0, consent: 0 };
  let anyMissing = 0;
  for (const row of filtered) {
    const dec = (field: keyof EncryptedWaitinglistReportRow) => readStoredField(row, field).trim();
    const g = dec('jenis_kelamin');
    if (g === 'putra' || g === 'putri') gender[g]++; else gender.unrecorded++;
    const e = dec('status_eligibility');
    if (e === 'eligible') eligibilityAtSubmission.eligible++; else if (e === 'not_eligible') eligibilityAtSubmission.notEligible++; else eligibilityAtSubmission.unrecorded++;
    const province = dec('provinsi_nama'), regency = dec('kabupaten_nama'), district = dec('kecamatan_nama'), school = dec('sekolah_asal');
    const key = `${province}\u0000${regency}\u0000${district}`;
    const area = districts.get(key) ?? { province, regency, district, total: 0 }; area.total++; districts.set(key, area);
    add('provinsi', province, province || 'Belum tercatat', province ? { provinsi: province } : undefined);
    add('kabupaten', `${province}\u0000${regency}`, `${regency || 'Belum tercatat'} · ${province}`, regency ? { provinsi: province, kabupaten: regency } : undefined);
    add('kecamatan', key, `${district || 'Belum tercatat'} · ${regency} · ${province}`, district ? { provinsi: province, kabupaten: regency, kecamatan: district } : undefined);
    add('sekolah', school.toLocaleLowerCase(), school || 'Belum tercatat', school ? { sekolah: school } : { missing: 'school' });
    const age = recordedAgeGroup(row);
    const ages: Record<string, string> = { under6: '<6 tahun', '6to7': '6–<7 tahun', '7to8': '7–<8 tahun', '8plus': '≥8 tahun', unknown: 'Belum tercatat' };
    add('usia', age, ages[age]!, { age_group: age });
    const parent = dec('status_ortu');
    add('orangTua', parent, parent === 'bapak' ? 'Bapak' : parent === 'ibu' ? 'Ibu' : parent || 'Belum tercatat');
    add('gender', ['putra', 'putri'].includes(g) ? g : 'unknown', g === 'putra' ? 'Putra' : g === 'putri' ? 'Putri' : 'Belum tercatat', g === 'putra' || g === 'putri' ? { jenis_kelamin: g } : { missing: 'gender' });
    add('eligibility', ['eligible', 'not_eligible'].includes(e) ? e : 'unknown', e === 'eligible' ? 'Memenuhi saat daftar' : e === 'not_eligible' ? 'Belum memenuhi saat daftar' : 'Belum tercatat', ['eligible', 'not_eligible'].includes(e) ? { status: e } : undefined);
    const missing = missingRecordFields(row);
    if (Object.values(missing).some(Boolean)) anyMissing++;
    for (const key of Object.keys(missingCounts) as Array<keyof typeof missingCounts>) if (missing[key]) missingCounts[key]++;
  }
  const percent = (value: number) => total ? Math.round(value / total * 1000) / 10 : 0;
  const labels = { gender: 'Jenis kelamin belum tercatat', school: 'Sekolah asal belum tercatat', proof: 'Metadata lampiran belum tercatat', consent: 'Persetujuan belum lengkap tercatat' };
  return {
    total, generatedAt: now.toISOString(), scope: query.view === 'archived' ? 'Arsip' : 'Aktif', recent,
    registrationPeriod: { start: startDate, end: endDate, label: startDate || endDate ? `${startDate ?? 'awal data'} – ${endDate ?? 'tanpa batas akhir'}` : 'Semua pendaftar' },
    daily, gender, eligibilityAtSubmission,
    topDistricts: [...districts.values()].sort((a, b) => b.total - a.total || a.district.localeCompare(b.district, 'id')).slice(0, 8),
    trend: { start, end, interval: interval === 'yearly' ? `${yearStep}-year` : interval, buckets },
    breakdowns: Object.fromEntries(Object.entries(maps).map(([key, map]) => [key, [...map.values()].map(value => ({ ...value, percent: percent(value.total) })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'id'))])),
    completeness: { any: anyMissing, fields: Object.entries(missingCounts).map(([key, value]) => ({ label: labels[key as keyof typeof labels], total: value, percent: percent(value), filter: { missing: key } })) },
  };
}
