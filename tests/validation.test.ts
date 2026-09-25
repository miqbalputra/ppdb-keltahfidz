import { describe, expect, test } from "bun:test";
import {
  completedAgeMonths,
  csvSafe,
  eligibleBirthdate,
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
};

function validPayload() {
  return {
    nama_ortu: "Aminah",
    status_ortu: "ibu",
    nama_anak: "Ahmad",
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
  };
}

describe("eligibility rules", () => {
  test("computes the exact birthdate boundary from system settings", () => {
    expect(eligibleBirthdate(settings)).toBe("2021-01-01");
    expect(validateWaitinglist(validPayload(), settings).umur_terhitung_bulan).toBe(78);
  });

  test("rejects a birthdate one day after the boundary", () => {
    expect(() => validateWaitinglist({ ...validPayload(), tanggal_lahir_anak: "2021-01-02" }, settings))
      .toThrow("belum masuk kriteria");
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

  test("requires explicit data confirmation", () => {
    expect(() => validateWaitinglist({ ...validPayload(), konfirmasi_data: false }, settings))
      .toThrow("Centang konfirmasi");
  });

  test("validates editable system settings and WhatsApp URL", () => {
    expect(validateSettings({ ...settings, whatsappGroupUrl: "https://chat.whatsapp.com/example" }))
      .toMatchObject({ whatsappGroupUrl: "https://chat.whatsapp.com/example" });
    expect(() => validateSettings({ ...settings, whatsappGroupUrl: "https://evil.example/invite" }))
      .toThrow("WhatsApp");
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
