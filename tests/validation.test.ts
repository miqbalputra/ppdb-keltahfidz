import { describe, expect, test } from "bun:test";
import {
  addCalendarYears,
  completedAgeMonths,
  csvSafe,
  eligibleBirthdate,
  eligibilityRetryMessage,
  isRegistrationOpen,
  openingTimestamp,
  nextEligibleCohort,
  normalizePhone,
  validateSettings,
  validateWaitinglist,
  type SystemSettings,
} from "../src/lib/validation";

const settings: SystemSettings = {
  cutoffDate: "2027-07-01",
  minAgeYears: 6,
  minAgeMonths: 6,
  whatsappGroupUrl: "",
  openingCountdownEnabled: false,
  openingDateTime: "",
};

function validPayload() {
  return {
    nama_ortu: "Aminah",
    status_ortu: "ibu",
    nama_anak: "Ahmad",
    jenis_kelamin: "putra",
    sekolah_asal: " TAUD Griya Qur'an ",
    tanggal_lahir_anak: "2021-01-01",
    provinsi_id: "32",
    provinsi_nama: "Jawa Barat",
    kabupaten_id: "32.73",
    kabupaten_nama: "Kota Bandung",
    kecamatan_id: "32.73.01",
    kecamatan_nama: "Sukasari",
    desa_id: "32.73.01.1001",
    desa_nama: "Sukarasa",
    no_hp_wa: "0812-3456 7890",
    email: "aminah@example.com",
    konfirmasi_data: true,
    konfirmasi_bukti_transfer: true,
    konfirmasi_ketentuan_biaya: true,
  };
}

describe("eligibility rules", () => {
  test("computes the exact birthdate boundary from system settings", () => {
    expect(eligibleBirthdate(settings)).toBe("2021-01-01");
    expect(validateWaitinglist(validPayload(), settings).umur_terhitung_bulan).toBe(78);
  });

  test("rejects a birthdate one day after the boundary with the next eligible cohort", () => {
    expect(() => validateWaitinglist({ ...validPayload(), tanggal_lahir_anak: "2021-01-02" }, settings))
      .toThrow("SPSB 2028, sekitar 1 tahun lagi");
    expect(eligibilityRetryMessage("2021-01-02", settings))
      .toBe("Mohon maaf umur Ananda belum masuk kriteria SPSB 2027. Ananda dapat mendaftar kembali pada SPSB 2028, sekitar 1 tahun lagi.");
  });

  test("finds the first annual cohort that meets the configured minimum age", () => {
    expect(nextEligibleCohort("2022-06-01", settings)).toEqual({
      cutoffDate: "2029-07-01",
      year: 2029,
      yearsAway: 2,
    });
    expect(nextEligibleCohort("2022-06-01", { ...settings, minAgeYears: 8, minAgeMonths: 0 }))
      .toMatchObject({ year: 2030, yearsAway: 3 });
  });

  test("clamps leap-day annual cutoffs to the last valid day of February", () => {
    expect(addCalendarYears("2028-02-29", 1)).toBe("2029-02-28");
  });

  test("normalizes optional school names and permits children without a prior school", () => {
    expect(validateWaitinglist(validPayload(), settings).sekolah_asal).toBe("TAUD Griya Qur'an");
    expect(validateWaitinglist({ ...validPayload(), sekolah_asal: "   " }, settings).sekolah_asal).toBeNull();
    expect(() => validateWaitinglist({ ...validPayload(), sekolah_asal: "S".repeat(121) }, settings))
      .toThrow("Sekolah asal terlalu panjang.");
  });

  test("requires the calon santri's gender to be Putra or Putri", () => {
    expect(validateWaitinglist({ ...validPayload(), jenis_kelamin: "putri" }, settings).jenis_kelamin).toBe("putri");
    expect(() => validateWaitinglist({ ...validPayload(), jenis_kelamin: "" }, settings))
      .toThrow("Pilih jenis kelamin Putra atau Putri.");
    expect(() => validateWaitinglist({ ...validPayload(), jenis_kelamin: "lainnya" }, settings))
      .toThrow("Pilih jenis kelamin Putra atau Putri.");
  });

  test("requires region IDs to match the EMSIFA v2 hierarchy", () => {
    expect(() => validateWaitinglist({ ...validPayload(), kabupaten_id: "32.73.01" }, settings))
      .toThrow("Kabupaten/Kota");
    expect(() => validateWaitinglist({ ...validPayload(), desa_id: "32.73.01" }, settings))
      .toThrow("Desa/Kelurahan");
  });

  test("completed months respect day of month", () => {
    expect(completedAgeMonths("2021-01-02", "2027-07-01")).toBe(77);
  });
});

describe("input normalization", () => {
  test("normalizes Indonesian mobile numbers", () => {
    expect(normalizePhone("0812-3456 7890")).toBe("6281234567890");
    expect(normalizePhone("+62 (812) 3456-7890")).toBe("6281234567890");
    expect(normalizePhone("6281234567890")).toBe("6281234567890");
  });

  test("rejects invalid prefixes and landlines", () => {
    expect(() => normalizePhone("81234567890")).toThrow("Format nomor tidak dikenali");
    expect(() => normalizePhone("021123456")).toThrow("Nomor WhatsApp tidak valid");
  });

  test("requires explicit data, payment-proof, and payment-terms confirmations", () => {
    expect(() => validateWaitinglist({ ...validPayload(), konfirmasi_data: false }, settings))
      .toThrow("Centang konfirmasi bahwa data sudah benar dan lengkap.");
    expect(() => validateWaitinglist({ ...validPayload(), konfirmasi_bukti_transfer: false }, settings))
      .toThrow("Centang konfirmasi bahwa bukti transfer biaya pendaftaran sudah dikirim.");
    expect(() => validateWaitinglist({ ...validPayload(), konfirmasi_ketentuan_biaya: false }, settings))
      .toThrow("Setujui ketentuan biaya pendaftaran sebelum melanjutkan.");
  });

  test("opens registration only when disabled or its valid WIB opening time has arrived", () => {
    const scheduled = { ...settings, openingCountdownEnabled: true, openingDateTime: "2027-07-01T09:30" };
    expect(openingTimestamp(scheduled.openingDateTime)).toBe(Date.UTC(2027, 6, 1, 2, 30));
    expect(isRegistrationOpen(scheduled, new Date("2027-07-01T02:29:59Z"))).toBe(false);
    expect(isRegistrationOpen(scheduled, new Date("2027-07-01T02:30:00Z"))).toBe(true);
    expect(isRegistrationOpen({ ...scheduled, openingDateTime: "invalid" }, new Date())).toBe(false);
    expect(isRegistrationOpen(settings, new Date())).toBe(true);
  });

  test("validates editable system settings and WhatsApp URL", () => {
    expect(validateSettings({ ...settings, whatsappGroupUrl: "https://chat.whatsapp.com/example" }))
      .toMatchObject({ whatsappGroupUrl: "https://chat.whatsapp.com/example" });
    expect(() => validateSettings({ ...settings, whatsappGroupUrl: "https://evil.example/invite" }))
      .toThrow("WhatsApp");
    expect(() => validateSettings({ ...settings, openingCountdownEnabled: true }))
      .toThrow("Tanggal dan jam pembukaan WIB wajib diisi");
    expect(() => validateSettings({ ...settings, openingDateTime: "2027-02-30T09:30" }))
      .toThrow("Tanggal dan jam pembukaan WIB tidak valid");
  });

  test("neutralizes CSV formulas", () => {
    expect(csvSafe("  =1+1")).toBe("'  =1+1");
  });
});

describe("admin sessions", () => {
  test("validates signed sessions and rejects tampering", async () => {
    process.env.ADMIN_USERNAME = "test-admin";
    process.env.ADMIN_PASSWORD = "test-admin-password";
    process.env.APP_SECRET = "test-secret-with-more-than-32-characters";
    process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const { clientIp, createSession, sessionCookie, validateSession } = await import("../src/lib/auth");
    const session = createSession("test-admin");
    expect(validateSession(session.token)?.username).toBe("test-admin");
    expect(validateSession(`${session.token}tampered`)).toBeNull();
    expect(sessionCookie(session.token)).toContain("SameSite=Strict");
    expect(clientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })))
      .toBe("203.0.113.7");
    expect(clientIp(new Request("http://localhost", { headers: { "x-forwarded-for": "not-an-ip" } })))
      .toBe("unknown");
  });
});
