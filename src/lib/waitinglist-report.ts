import { decryptField } from "./encryption";
import { matchesEncryptedWaitinglist, type EncryptedWaitinglistFilterRow, type WaitinglistFilterQuery } from "./waitinglist-filters";

export interface EncryptedWaitinglistReportRow extends EncryptedWaitinglistFilterRow {
  kabupaten_nama: string;
  provinsi_nama: string;
}

export interface WaitinglistReport {
  total: number;
  registrationPeriod: { start: string | null; end: string | null; label: string };
  daily: Array<{ date: string; total: number }>;
  gender: { putra: number; putri: number; unrecorded: number };
  eligibilityAtSubmission: { eligible: number; notEligible: number; unrecorded: number };
  topDistricts: Array<{ district: string; regency: string; province: string; total: number }>;
}

function jakartaDate(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? new Date(parsed + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) : "";
}

function currentJakartaDate(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function buildWaitinglistReport(
  rows: EncryptedWaitinglistReportRow[],
  query: WaitinglistFilterQuery,
  now = new Date(),
): WaitinglistReport {
  const filtered = rows.filter((row) => matchesEncryptedWaitinglist(row, query));
  const startDate = query.tanggal_daftar_mulai ?? null;
  const endDate = query.tanggal_daftar_sampai ?? null;
  const end = endDate ?? currentJakartaDate(now);
  const start = startDate ?? shiftDate(end, -29);
  const dailyCounts = new Map<string, number>();
  for (const row of filtered) {
    const date = jakartaDate(row.created_at);
    if (date >= start && date <= end) dailyCounts.set(date, (dailyCounts.get(date) ?? 0) + 1);
  }
  const daily: WaitinglistReport["daily"] = [];
  const firstDay = Date.parse(`${start}T00:00:00Z`);
  const lastDay = Date.parse(`${end}T00:00:00Z`);
  // Explicit date ranges are bounded to 366 days; otherwise show the latest 30 days.
  const boundedStart = Number.isFinite(firstDay) && Number.isFinite(lastDay) && lastDay >= firstDay
    ? Math.max(firstDay, lastDay - 365 * 24 * 60 * 60 * 1000)
    : lastDay - 29 * 24 * 60 * 60 * 1000;
  for (let time = boundedStart; time <= lastDay; time += 24 * 60 * 60 * 1000) {
    const date = new Date(time).toISOString().slice(0, 10);
    daily.push({ date, total: dailyCounts.get(date) ?? 0 });
  }

  const gender = { putra: 0, putri: 0, unrecorded: 0 };
  const eligibilityAtSubmission = { eligible: 0, notEligible: 0, unrecorded: 0 };
  const districts = new Map<string, { district: string; regency: string; province: string; total: number }>();
  for (const row of filtered) {
    const genderValue = row.jenis_kelamin
      ? decryptField(row.jenis_kelamin, "jenis_kelamin", row.id)
      : "";
    if (genderValue === "putra") gender.putra += 1;
    else if (genderValue === "putri") gender.putri += 1;
    else gender.unrecorded += 1;

    const eligibility = decryptField(row.status_eligibility, "status_eligibility", row.id);
    if (eligibility === "eligible") eligibilityAtSubmission.eligible += 1;
    else if (eligibility === "not_eligible") eligibilityAtSubmission.notEligible += 1;
    else eligibilityAtSubmission.unrecorded += 1;

    const district = decryptField(row.kecamatan_nama, "kecamatan_nama", row.id);
    const regency = decryptField(row.kabupaten_nama, "kabupaten_nama", row.id);
    const province = decryptField(row.provinsi_nama, "provinsi_nama", row.id);
    const key = `${district}\u0000${regency}\u0000${province}`;
    const aggregate = districts.get(key) ?? { district, regency, province, total: 0 };
    aggregate.total += 1;
    districts.set(key, aggregate);
  }

  return {
    total: filtered.length,
    registrationPeriod: {
      start: startDate,
      end: endDate,
      label: startDate || endDate ? `${startDate ?? "awal data"} – ${endDate ?? "hari ini"}` : "Semua pendaftar",
    },
    daily,
    gender,
    eligibilityAtSubmission,
    topDistricts: [...districts.values()].sort((a, b) => b.total - a.total
      || a.district.localeCompare(b.district, "id")).slice(0, 8),
  };
}
