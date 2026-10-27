import { readStoredField } from "./encryption";
import { isValidIsoDate } from "./validation";

export interface WaitinglistFilterQuery {
  q?: string;
  view?: string;
  sort?: string;
  page_size?: string;
  provinsi?: string;
  kabupaten?: string;
  sekolah?: string;
  missing?: string;
  age_group?: string;
  trend?: string;
  status?: string;
  kecamatan?: string;
  jenis_kelamin?: string;
  tanggal_daftar_mulai?: string;
  tanggal_daftar_sampai?: string;
  tanggal_lahir_mulai?: string;
  tanggal_lahir_sampai?: string;
}

export interface EncryptedWaitinglistFilterRow {
  id: string;
  nama_anak: string;
  nama_ortu: string;
  email: string;
  no_hp_wa: string;
  desa_nama: string;
  jenis_kelamin: string | null;
  tanggal_lahir_anak: string;
  created_at: string;
  status_eligibility: string;
  kecamatan_nama: string;
  provinsi_nama?: string;
  kabupaten_nama?: string;
  sekolah_asal?: string | null;
  umur_terhitung_bulan?: string;
  bukti_transfer_mime?: string | null;
  konfirmasi_data?: number;
  konfirmasi_bukti_transfer?: number | null;
  konfirmasi_ketentuan_biaya?: number | null;
}

const rangePairs = [
  ["tanggal_daftar_mulai", "tanggal_daftar_sampai", "Tanggal pendaftaran"],
  ["tanggal_lahir_mulai", "tanggal_lahir_sampai", "Tanggal lahir"],
] as const;

export function validateWaitinglistFilterQuery(query: WaitinglistFilterQuery): string | null {
  for (const [startKey, endKey, label] of rangePairs) {
    const start = query[startKey];
    const end = query[endKey];
    if (start && !isValidIsoDate(start)) return `${label} awal tidak valid.`;
    if (end && !isValidIsoDate(end)) return `${label} akhir tidak valid.`;
    if (start && end && start > end) return `Rentang ${label.toLocaleLowerCase()} harus berurutan dari tanggal awal ke tanggal akhir.`;
  }
  const enums: Record<string, string[]> = {
    view: ['active', 'archived'], sort: ['newest', 'oldest', 'name', 'age'],
    page_size: ['25', '50', '100'], trend: ['auto', 'daily', 'weekly', 'monthly'],
    missing: ['all', 'any', 'gender', 'school', 'proof', 'consent'],
    age_group: ['all', 'under6', '6to7', '7to8', '8plus', 'unknown'],
  };
  for (const [key, allowed] of Object.entries(enums)) {
    const value = query[key as keyof WaitinglistFilterQuery];
    if (value && !allowed.includes(value)) return `Filter ${key} tidak valid.`;
  }
  return null;
}

export function registrationCreatedAtBounds(query: WaitinglistFilterQuery): {
  startInclusive?: string;
  endExclusive?: string;
} {
  const nextDate = (date: string): string => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
  };
  return {
    startInclusive: query.tanggal_daftar_mulai
      ? new Date(`${query.tanggal_daftar_mulai}T00:00:00+07:00`).toISOString()
      : undefined,
    endExclusive: query.tanggal_daftar_sampai
      ? new Date(`${nextDate(query.tanggal_daftar_sampai)}T00:00:00+07:00`).toISOString()
      : undefined,
  };
}

export function hasWaitinglistFilters(query: WaitinglistFilterQuery): boolean {
  return Boolean(
    query.q?.trim()
    || query.provinsi?.trim() || query.kabupaten?.trim() || query.sekolah?.trim()
    || (query.missing && query.missing !== 'all')
    || (query.age_group && query.age_group !== 'all')
    || query.kecamatan?.trim()
    || (query.status && query.status !== "all")
    || (query.jenis_kelamin && query.jenis_kelamin !== "all")
    || query.tanggal_daftar_mulai
    || query.tanggal_daftar_sampai
    || query.tanggal_lahir_mulai
    || query.tanggal_lahir_sampai,
  );
}

function jakartaDate(isoTimestamp: string): string {
  const timestamp = Date.parse(isoTimestamp);
  return Number.isFinite(timestamp)
    ? new Date(timestamp + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : "";
}

export function missingRecordFields(row: EncryptedWaitinglistFilterRow) {
  const gender = readStoredField(row, 'jenis_kelamin');
  const school = readStoredField(row, 'sekolah_asal').trim();
  return {
    gender: !['putra', 'putri'].includes(gender), school: !school,
    proof: !row.bukti_transfer_mime,
    consent: row.konfirmasi_data !== 1 || row.konfirmasi_bukti_transfer !== 1 || row.konfirmasi_ketentuan_biaya !== 1,
  };
}

export function recordedAgeGroup(row: EncryptedWaitinglistFilterRow): string {
  const raw = readStoredField(row, 'umur_terhitung_bulan');
  const age = raw.trim() ? Number(raw) : NaN;
  return !Number.isFinite(age) || age < 0 ? 'unknown' : age < 72 ? 'under6' : age < 84 ? '6to7' : age < 96 ? '7to8' : '8plus';
}

export function sortWaitinglist<T extends EncryptedWaitinglistFilterRow>(rows: T[], sort = 'newest'): T[] {
  const keys = new Map(rows.map(row => {
    const raw = sort === 'age' ? readStoredField(row, 'umur_terhitung_bulan').trim() : '';
    const age = raw && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : -1;
    return [row.id, sort === 'name' ? readStoredField(row, 'nama_anak') : sort === 'age' ? age : row.created_at];
  }));
  return [...rows].sort((a, b) => {
    const x = keys.get(a.id)!; const y = keys.get(b.id)!;
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'id');
    return (sort === 'newest' ? -cmp : cmp) || a.id.localeCompare(b.id);
  });
}

export function matchesEncryptedWaitinglist(
  row: EncryptedWaitinglistFilterRow,
  query: WaitinglistFilterQuery,
): boolean {
  const status = query.status ?? "all";
  if ((status === "eligible" || status === "not_eligible")
    && readStoredField(row, 'status_eligibility') !== status) return false;

  const gender = query.jenis_kelamin ?? "all";
  if (gender === "putra" || gender === "putri") {
    const rowGender = row.jenis_kelamin
      ? readStoredField(row, 'jenis_kelamin')
      : "";
    if (rowGender !== gender) return false;
  }

  const district = (query.kecamatan ?? "").trim().slice(0, 120).toLocaleLowerCase();
  if (district) {
    const actual = readStoredField(row, 'kecamatan_nama').trim().toLocaleLowerCase();
    // A hierarchical selection must not mix Sukasari with Sukasari Barat.
    if (query.provinsi || query.kabupaten ? actual !== district : !actual.includes(district)) return false;
  }

  const registrationDate = jakartaDate(row.created_at);
  if (query.tanggal_daftar_mulai && registrationDate < query.tanggal_daftar_mulai) return false;
  if (query.tanggal_daftar_sampai && registrationDate > query.tanggal_daftar_sampai) return false;

  if (query.tanggal_lahir_mulai || query.tanggal_lahir_sampai) {
    const birthDate = readStoredField(row, 'tanggal_lahir_anak');
    if (query.tanggal_lahir_mulai && birthDate < query.tanggal_lahir_mulai) return false;
    if (query.tanggal_lahir_sampai && birthDate > query.tanggal_lahir_sampai) return false;
  }

  for (const [key, field] of [['provinsi', 'provinsi_nama'], ['kabupaten', 'kabupaten_nama'], ['sekolah', 'sekolah_asal']] as const) {
    const expected = query[key]?.trim().toLocaleLowerCase();
    const stored = row[field];
    if (expected && (!stored || readStoredField(row, field).trim().toLocaleLowerCase() !== expected)) return false;
  }
  if (query.missing && query.missing !== 'all') {
    const missing = missingRecordFields(row);
    if (query.missing === 'any' ? !Object.values(missing).some(Boolean) : !missing[query.missing as keyof typeof missing]) return false;
  }
  if (query.age_group && query.age_group !== 'all' && recordedAgeGroup(row) !== query.age_group) return false;

  const text = (query.q ?? "").trim().slice(0, 120).toLocaleLowerCase();
  if (text) {
    const searchableFields = [
      ["nama_anak", row.nama_anak],
      ["nama_ortu", row.nama_ortu],
      ["email", row.email],
      ["no_hp_wa", row.no_hp_wa],
      ["desa_nama", row.desa_nama],
    ] as const;
    const extras = [['sekolah_asal', row.sekolah_asal], ['provinsi_nama', row.provinsi_nama], ['kabupaten_nama', row.kabupaten_nama], ['kecamatan_nama', row.kecamatan_nama]] as const;
    const found = row.id.toLocaleLowerCase().includes(text) || [...searchableFields, ...extras].some(([field, value]) => (
      value && readStoredField(row, field).toLocaleLowerCase().includes(text)
    ));
    if (!found) return false;
  }
  return true;
}
