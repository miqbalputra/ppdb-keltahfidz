import { describe, expect, test } from "bun:test";

process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const [{ encryptField }, { buildWaitinglistReport }] = await Promise.all([
  import("../src/lib/encryption"),
  import("../src/lib/waitinglist-report"),
]);

function encryptedRow(id: string, values: Record<string, string | null> = {}) {
  const clear = {
    nama_anak: `Peserta ${id}`,
    nama_ortu: `Orang tua ${id}`,
    email: `${id}@example.test`,
    no_hp_wa: "6281234567890",
    desa_nama: "Sukarasa",
    jenis_kelamin: "putri" as string | null,
    tanggal_lahir_anak: "2021-01-01",
    created_at: "2027-02-02T10:30:00.000Z",
    status_eligibility: "eligible",
    kecamatan_nama: "Sukasari",
    kabupaten_nama: "Bandung",
    provinsi_nama: "Jawa Barat",
    ...values,
  };
  const row = { ...clear, id };
  for (const field of [
    "nama_anak", "nama_ortu", "email", "no_hp_wa", "desa_nama", "jenis_kelamin",
    "tanggal_lahir_anak", "status_eligibility", "kecamatan_nama", "kabupaten_nama", "provinsi_nama",
  ] as const) {
    const value = clear[field];
    if (value !== null) row[field] = encryptField(value, field, id);
  }
  return row;
}

describe("admin waiting-list reports", () => {
  test("summarizes encrypted rows without returning participant identities and uses registration snapshots", () => {
    const rows = [
      encryptedRow("00000000000000000000000000000001", { created_at: "2027-02-02T10:30:00.000Z", jenis_kelamin: "putri" }),
      encryptedRow("00000000000000000000000000000002", { created_at: "2027-02-03T10:30:00.000Z", jenis_kelamin: "putra", status_eligibility: "not_eligible" }),
      encryptedRow("00000000000000000000000000000003", { created_at: "2027-02-03T12:30:00.000Z", jenis_kelamin: null, desa_nama: "Ciumbuleuit", status_eligibility: "legacy_unknown" }),
    ];
    const report = buildWaitinglistReport(rows, {}, new Date("2027-02-04T00:00:00.000Z"));
    expect(report.total).toBe(3);
    expect(report.daily).toHaveLength(30);
    expect(report.gender).toEqual({ putra: 1, putri: 1, unrecorded: 1 });
    expect(report.eligibilityAtSubmission).toEqual({ eligible: 1, notEligible: 1, unrecorded: 1 });
    expect(report.topDistricts[0]).toMatchObject({ district: "Sukasari", regency: "Bandung", province: "Jawa Barat", total: 3 });
    expect(report.daily.filter((entry) => entry.total > 0)).toEqual([
      { date: "2027-02-02", total: 1 }, { date: "2027-02-03", total: 2 },
    ]);
    expect(JSON.stringify(report)).not.toContain("Peserta ");
    expect(JSON.stringify(report)).not.toContain("example.test");
    expect(JSON.stringify(report)).not.toContain("6281234567890");
  });

  test("applies the same encrypted search, status, gender, district, and inclusive dates before aggregation", () => {
    const rows = [
      encryptedRow("00000000000000000000000000000011", { created_at: "2027-02-02T10:30:00.000Z" }),
      encryptedRow("00000000000000000000000000000012", { created_at: "2027-02-03T10:30:00.000Z", status_eligibility: "not_eligible" }),
      encryptedRow("00000000000000000000000000000013", { created_at: "2027-02-04T10:30:00.000Z", kecamatan_nama: "Cidadap" }),
    ];
    const report = buildWaitinglistReport(rows, {
      q: "peserta 00000000000000000000000000000011",
      status: "eligible",
      jenis_kelamin: "putri",
      kecamatan: "suka",
      tanggal_daftar_mulai: "2027-02-02",
      tanggal_daftar_sampai: "2027-02-02",
    }, new Date("2027-02-10T00:00:00.000Z"));
    expect(report.total).toBe(1);
    expect(report.daily).toEqual([{ date: "2027-02-02", total: 1 }]);
    expect(report.eligibilityAtSubmission).toEqual({ eligible: 1, notEligible: 0, unrecorded: 0 });
    expect(report.registrationPeriod).toEqual({ start: "2027-02-02", end: "2027-02-02", label: "2027-02-02 – 2027-02-02" });
  });
});
