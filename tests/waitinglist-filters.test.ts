import { describe, expect, test } from "bun:test";

process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const [{ encryptField }, filtersModule] = await Promise.all([
  import("../src/lib/encryption"),
  import("../src/lib/waitinglist-filters"),
]);

function encryptedRow(overrides: Partial<{
  id: string;
  nama_anak: string;
  nama_ortu: string;
  email: string;
  no_hp_wa: string;
  desa_nama: string;
  jenis_kelamin: string;
  tanggal_lahir_anak: string;
  created_at: string;
  status_eligibility: string;
  kecamatan_nama: string;
}> = {}) {
  const clear = {
    id: "0123456789abcdef0123456789abcdef",
    nama_anak: "Amina Zahra",
    nama_ortu: "Siti Aminah",
    email: "amina@example.test",
    no_hp_wa: "6281234567890",
    desa_nama: "Sukarasa",
    jenis_kelamin: "putri",
    tanggal_lahir_anak: "2021-01-05",
    created_at: "2027-02-02T10:30:00.000Z",
    status_eligibility: "eligible",
    kecamatan_nama: "Sukasari",
    ...overrides,
  };
  const encryptedFields = [
    "nama_anak", "nama_ortu", "email", "no_hp_wa", "desa_nama", "jenis_kelamin",
    "tanggal_lahir_anak", "status_eligibility", "kecamatan_nama",
  ] as const;
  const result = { ...clear };
  for (const field of encryptedFields) {
    result[field] = encryptField(clear[field], field, clear.id);
  }
  return result;
}

describe("waiting-list filters", () => {
  test("matches gender, eligibility, search, district, and inclusive registration/birth date ranges together", () => {
    const row = encryptedRow();
    expect(filtersModule.matchesEncryptedWaitinglist(row, {
      q: "amina@example",
      status: "eligible",
      kecamatan: "suka",
      jenis_kelamin: "putri",
      tanggal_daftar_mulai: "2027-02-02",
      tanggal_daftar_sampai: "2027-02-02",
      tanggal_lahir_mulai: "2021-01-05",
      tanggal_lahir_sampai: "2021-01-05",
    })).toBe(true);
  });

  test("filters registration dates by the school's Jakarta calendar day", () => {
    const row = encryptedRow({ created_at: "2027-02-01T20:00:00.000Z" });
    expect(filtersModule.matchesEncryptedWaitinglist(row, {
      tanggal_daftar_mulai: "2027-02-02",
      tanggal_daftar_sampai: "2027-02-02",
    })).toBe(true);
    expect(filtersModule.matchesEncryptedWaitinglist(row, {
      tanggal_daftar_sampai: "2027-02-01",
    })).toBe(false);
  });

  test("rejects rows that fail any active filter", () => {
    const row = encryptedRow();
    expect(filtersModule.matchesEncryptedWaitinglist(row, { jenis_kelamin: "putra" })).toBe(false);
    expect(filtersModule.matchesEncryptedWaitinglist(row, { status: "not_eligible" })).toBe(false);
    expect(filtersModule.matchesEncryptedWaitinglist(row, { tanggal_daftar_mulai: "2027-02-03" })).toBe(false);
    expect(filtersModule.matchesEncryptedWaitinglist(row, { tanggal_lahir_sampai: "2021-01-04" })).toBe(false);
    expect(filtersModule.matchesEncryptedWaitinglist(row, { q: "tidak ditemukan" })).toBe(false);
    expect(filtersModule.matchesEncryptedWaitinglist(row, { kecamatan: "Cidadap" })).toBe(false);
  });

  test("recognizes new filters and validates real dates and range order", () => {
    expect(filtersModule.hasWaitinglistFilters({ jenis_kelamin: "putri" })).toBe(true);
    expect(filtersModule.hasWaitinglistFilters({ tanggal_daftar_mulai: "2027-02-01" })).toBe(true);
    expect(filtersModule.validateWaitinglistFilterQuery({
      tanggal_lahir_mulai: "2021-02-29",
    })).toContain("tidak valid");
    expect(filtersModule.validateWaitinglistFilterQuery({
      tanggal_daftar_mulai: "2027-02-03",
      tanggal_daftar_sampai: "2027-02-02",
    })).toContain("harus berurutan");
    expect(filtersModule.validateWaitinglistFilterQuery({
      tanggal_lahir_mulai: "2021-01-01",
      tanggal_lahir_sampai: "2021-01-31",
    })).toBeNull();
  });
});
