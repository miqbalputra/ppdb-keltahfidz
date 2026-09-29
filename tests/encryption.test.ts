import { describe, expect, test } from "bun:test";
import { createCipheriv } from "node:crypto";

process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const {
  decryptField,
  decryptPaymentProof,
  decryptSensitiveRecord,
  encryptField,
  encryptLegacyFields,
  encryptPaymentProof,
  encryptSensitiveRecord,
} = await import("../src/lib/encryption");

describe("sensitive data encryption", () => {
  test("encrypts with randomized AES-GCM ciphertext and field binding", () => {
    const first = encryptField("aminah@example.com", "email");
    const second = encryptField("aminah@example.com", "email");
    expect(first).not.toBe(second);
    expect(first).not.toContain("aminah");
    expect(decryptField(first, "email")).toBe("aminah@example.com");
    expect(() => decryptField(first, "nama_ortu")).toThrow("DATA_ENCRYPTION_KEY");
  });

  test("encrypts all identity fields but decrypts the record for admin use", () => {
    const clear = {
      id: "0123456789abcdef0123456789abcdef",
      nama_ortu: "Aminah",
      status_ortu: "ibu",
      nama_anak: "Ahmad",
      jenis_kelamin: "putri",
      sekolah_asal: "TAUD Griya Qur'an",
      tanggal_lahir_anak: "2021-01-01",
      umur_terhitung_bulan: "78",
      status_eligibility: "eligible",
      provinsi_id: "31",
      provinsi_nama: "DKI Jakarta",
      no_hp_wa: "6281234567890",
      email: "aminah@example.com",
      created_at: "2026-09-25T12:00:00.000Z",
    };
    const encrypted = encryptSensitiveRecord(clear);
    expect(encrypted.nama_ortu).not.toBe(clear.nama_ortu);
    expect(encrypted.no_hp_wa).not.toBe(clear.no_hp_wa);
    expect(encrypted.jenis_kelamin).not.toBe(clear.jenis_kelamin);
    expect(encrypted.sekolah_asal).not.toBe(clear.sekolah_asal);
    expect(decryptSensitiveRecord(encrypted)).toMatchObject({
      nama_ortu: "Aminah",
      no_hp_wa: "6281234567890",
      jenis_kelamin: "putri",
      sekolah_asal: "TAUD Griya Qur'an",
      umur_terhitung_bulan: 78,
    });
    expect(() => decryptSensitiveRecord({ ...encrypted, id: "fedcba9876543210fedcba9876543210" })).toThrow("DATA_ENCRYPTION_KEY");
  });

  test("encrypts payment proof bytes and binds the ciphertext to the registration ID", () => {
    const clear = Buffer.from("%PDF-1.7\ntransfer receipt");
    const encrypted = encryptPaymentProof(clear, "0123456789abcdef0123456789abcdef");
    expect(encrypted.includes(clear)).toBe(false);
    expect(decryptPaymentProof(encrypted, "0123456789abcdef0123456789abcdef")).toEqual(clear);
    expect(() => decryptPaymentProof(encrypted, "fedcba9876543210fedcba9876543210")).toThrow("DATA_ENCRYPTION_KEY");
  });

  test("legacy rows can be upgraded once and the key is verified on later boots", () => {
    const legacy = { id: "0123456789abcdef0123456789abcdef", nama_ortu: "Aminah", email: "aminah@example.com" };
    const updates = encryptLegacyFields(legacy);
    expect(updates.nama_ortu).not.toBe("Aminah");
    expect(encryptLegacyFields({ ...legacy, ...updates })).toEqual({});
  });

  test("upgrades version-one encrypted values without losing the plaintext", () => {
    const key = Buffer.from(process.env.DATA_ENCRYPTION_KEY!, "hex");
    const iv = Buffer.alloc(12, 7);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from("spsb.waitinglist:email:v1", "utf8"));
    const body = Buffer.concat([cipher.update("aminah@example.com", "utf8"), cipher.final()]);
    const oldValue = `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${body.toString("base64url")}`;

    const upgraded = encryptLegacyFields({ id: "0123456789abcdef0123456789abcdef", email: oldValue });
    expect(upgraded.email).toStartWith("enc:v2:");
    expect(decryptField(upgraded.email, "email", "0123456789abcdef0123456789abcdef")).toBe("aminah@example.com");
  });
});
