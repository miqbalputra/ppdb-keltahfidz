import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DATA_ENCRYPTION_KEY } from "../config";

const ENCRYPTION_PREFIX = "enc:v2:";
const PAYMENT_PROOF_MAGIC = Buffer.from("SPSBPF01", "ascii");
const PAYMENT_PROOF_AAD_PREFIX = "spsb.payment-proof:v1:";
const ENCRYPTED_FIELDS = [
  "nama_ortu",
  "status_ortu",
  "nama_anak",
  "jenis_kelamin",
  "sekolah_asal",
  "tanggal_lahir_anak",
  "umur_terhitung_bulan",
  "status_eligibility",
  "provinsi_id",
  "provinsi_nama",
  "kabupaten_id",
  "kabupaten_nama",
  "kecamatan_id",
  "kecamatan_nama",
  "desa_id",
  "desa_nama",
  "no_hp_wa",
  "email",
  "payment_note",
] as const;

export type DecryptedRow<T extends Record<string, unknown>> = Omit<T, "umur_terhitung_bulan"> & {
  umur_terhitung_bulan: number;
};

export function isEncryptedValue(value: string): boolean {
  return value.startsWith("enc:v1:") || value.startsWith(ENCRYPTION_PREFIX);
}

function associatedData(field: string, recordId: string, version: "v1" | "v2"): Buffer {
  const context = version === "v1" ? field : `${recordId}:${field}`;
  return Buffer.from(`spsb.waitinglist:${context}:${version}`, "utf8");
}

export function encryptField(value: string, field: string, recordId = ""): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", DATA_ENCRYPTION_KEY, iv);
  cipher.setAAD(associatedData(field, recordId, "v2"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptField(value: string, field: string, recordId = ""): string {
  if (!isEncryptedValue(value)) return value;
  const parts = value.split(":");
  if (parts.length !== 5 || parts[0] !== "enc" || (parts[1] !== "v1" && parts[1] !== "v2")) {
    throw new Error("Format data terenkripsi tidak valid.");
  }
  const [, , ivBase64, tagBase64, bodyBase64] = parts;
  const version = parts[1];
  try {
    const decipher = createDecipheriv("aes-256-gcm", DATA_ENCRYPTION_KEY, Buffer.from(ivBase64, "base64url"));
    decipher.setAAD(associatedData(field, recordId, version));
    decipher.setAuthTag(Buffer.from(tagBase64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(bodyBase64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Data terenkripsi tidak dapat dibuka; periksa DATA_ENCRYPTION_KEY.");
  }
}

export function encryptPaymentProof(data: Uint8Array, recordId: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", DATA_ENCRYPTION_KEY, iv);
  cipher.setAAD(Buffer.from(`${PAYMENT_PROOF_AAD_PREFIX}${recordId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([PAYMENT_PROOF_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptPaymentProof(data: Uint8Array, recordId: string): Buffer {
  const encrypted = Buffer.from(data);
  const headerLength = PAYMENT_PROOF_MAGIC.length + 12 + 16;
  if (encrypted.length < headerLength || !encrypted.subarray(0, PAYMENT_PROOF_MAGIC.length).equals(PAYMENT_PROOF_MAGIC)) {
    throw new Error("Format bukti transfer terenkripsi tidak valid.");
  }
  const ivStart = PAYMENT_PROOF_MAGIC.length;
  const tagStart = ivStart + 12;
  try {
    const decipher = createDecipheriv("aes-256-gcm", DATA_ENCRYPTION_KEY, encrypted.subarray(ivStart, tagStart));
    decipher.setAAD(Buffer.from(`${PAYMENT_PROOF_AAD_PREFIX}${recordId}`, "utf8"));
    decipher.setAuthTag(encrypted.subarray(tagStart, headerLength));
    return Buffer.concat([decipher.update(encrypted.subarray(headerLength)), decipher.final()]);
  } catch {
    throw new Error("Bukti transfer terenkripsi tidak dapat dibuka; periksa DATA_ENCRYPTION_KEY.");
  }
}

export function encryptSensitiveRecord<T extends Record<string, unknown>>(record: T): T {
  const output = { ...record } as Record<string, unknown>;
  const recordId = String(output.id ?? "");
  for (const field of ENCRYPTED_FIELDS) {
    const value = output[field];
    if (value !== undefined && value !== null) output[field] = encryptField(String(value), field, recordId);
  }
  return output as T;
}

// Cached by row object, not ID: values live only as long as a request's rows.
// Keep ciphertext in datasets to avoid interpreting clear text beginning "enc:" twice.
const fieldCache = new WeakMap<object, Map<string, { input: string; output: string }>>();
export function readStoredField(record: object & { id: string }, field: string): string {
  const input = String((record as Record<string, unknown>)[field] ?? '');
  let cache = fieldCache.get(record);
  if (!cache) { cache = new Map(); fieldCache.set(record, cache); }
  const cached = cache.get(field);
  if (cached?.input === input) return cached.output;
  const output = decryptField(input, field, record.id);
  cache.set(field, { input, output });
  return output;
}

export function decryptSensitiveRecord<T extends Record<string, unknown>>(record: T): DecryptedRow<T> {
  const output = { ...record } as Record<string, unknown>;
  for (const field of ENCRYPTED_FIELDS) {
    if (record[field] !== undefined && record[field] !== null) output[field] = readStoredField(record as T & { id: string }, field);
  }
  const age = String(output.umur_terhitung_bulan ?? '').trim();
  output.umur_terhitung_bulan = age ? Number(age) : NaN;
  return output as DecryptedRow<T>;
}

export function encryptLegacyFields(record: Record<string, unknown>): Record<string, string> {
  const updates: Record<string, string> = {};
  const recordId = String(record.id ?? "");
  for (const field of ENCRYPTED_FIELDS) {
    if (record[field] === undefined || record[field] === null) continue;
    const value = String(record[field] ?? "");
    if (isEncryptedValue(value)) {
      const plaintext = decryptField(value, field, recordId);
      // Upgrade old ciphertext to bind it to this row as well as the field.
      if (value.startsWith("enc:v1:")) updates[field] = encryptField(plaintext, field, recordId);
    } else {
      updates[field] = encryptField(value, field, recordId);
    }
  }
  return updates;
}
