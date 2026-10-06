import { decryptField } from "./encryption";
import { isValidIsoDate } from "./validation";

export interface WaitinglistFilterQuery {
  q?: string;
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
  return null;
}

export function hasWaitinglistFilters(query: WaitinglistFilterQuery): boolean {
  return Boolean(
    query.q?.trim()
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

export function matchesEncryptedWaitinglist(
  row: EncryptedWaitinglistFilterRow,
  query: WaitinglistFilterQuery,
): boolean {
  const status = query.status ?? "all";
  if ((status === "eligible" || status === "not_eligible")
    && decryptField(row.status_eligibility, "status_eligibility", row.id) !== status) return false;

  const gender = query.jenis_kelamin ?? "all";
  if (gender === "putra" || gender === "putri") {
    const rowGender = row.jenis_kelamin
      ? decryptField(row.jenis_kelamin, "jenis_kelamin", row.id)
      : "";
    if (rowGender !== gender) return false;
  }

  const district = (query.kecamatan ?? "").trim().slice(0, 120).toLocaleLowerCase();
  if (district && !decryptField(row.kecamatan_nama, "kecamatan_nama", row.id).toLocaleLowerCase().includes(district)) {
    return false;
  }

  const registrationDate = jakartaDate(row.created_at);
  if (query.tanggal_daftar_mulai && registrationDate < query.tanggal_daftar_mulai) return false;
  if (query.tanggal_daftar_sampai && registrationDate > query.tanggal_daftar_sampai) return false;

  if (query.tanggal_lahir_mulai || query.tanggal_lahir_sampai) {
    const birthDate = decryptField(row.tanggal_lahir_anak, "tanggal_lahir_anak", row.id);
    if (query.tanggal_lahir_mulai && birthDate < query.tanggal_lahir_mulai) return false;
    if (query.tanggal_lahir_sampai && birthDate > query.tanggal_lahir_sampai) return false;
  }

  const text = (query.q ?? "").trim().slice(0, 120).toLocaleLowerCase();
  if (text) {
    const searchableFields = [
      ["nama_anak", row.nama_anak],
      ["nama_ortu", row.nama_ortu],
      ["email", row.email],
      ["no_hp_wa", row.no_hp_wa],
      ["desa_nama", row.desa_nama],
    ] as const;
    const found = searchableFields.some(([field, value]) => (
      decryptField(value, field, row.id).toLocaleLowerCase().includes(text)
    ));
    if (!found) return false;
  }
  return true;
}
