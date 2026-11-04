import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { APP_SECRET, N8N_PAYMENT_WEBHOOK_URL } from "../config";
import { db } from "../db";
import { calonSantriWaitinglist } from "../db/schema";
import { decryptSensitiveRecord } from "./encryption";
import { REGISTRATION_FEE } from "./payment-report";
import { findParticipant, readProof, validVersion, verifyPayment } from "./participants";
import { ServiceError, ensure } from "./admin-common";
import { isValidIsoDate } from "./validation";
import { extractPaymentProofText } from "./payment-ocr";
import { createPaymentReceiptAttempt, receiptLogSignature, recordLocalReceiptEvent, recordPaymentReceiptEvent } from "./payment-receipt-logs";

const OCR_REVIEWER = "OCR lokal (SPSB)";

function signatureFor(id: string, version: number, proofId: string): string {
  return createHmac("sha256", APP_SECRET)
    .update(`spsb-payment-proof:${id}:${version}:${proofId}`)
    .digest("hex");
}

function signatureMatches(received: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(received, "hex");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

export type PaymentProofQueueStatus = "queued" | "not_configured" | "failed";

/** Send the current saved proof and the minimum identity needed for verification and the receipt. */
export async function queuePaymentProofCheck(id: string, requestUrl: string): Promise<PaymentProofQueueStatus> {
  let attemptId = "";
  try {
    const [stored] = await db.select().from(calonSantriWaitinglist)
      .where(eq(calonSantriWaitinglist.id, id)).limit(1);
    if (!stored?.proof_id || !stored.bukti_transfer_mime) return "failed";

    const version = validVersion(stored.version);
    attemptId = await createPaymentReceiptAttempt(id, version, stored.proof_id);
    if (!N8N_PAYMENT_WEBHOOK_URL) {
      await recordLocalReceiptEvent(attemptId, "not_configured", "Webhook n8n tanda terima belum dikonfigurasi.");
      return "not_configured";
    }
    const participant = decryptSensitiveRecord(stored);
    const proof = await readProof(stored, stored.proof_id);
    const ocr = await extractPaymentProofText(proof.bytes, proof.mime);
    const callbackUrl = new URL(`/api/internal/payment-verification/${id}`, requestUrl).toString();
    const manualCallbackUrl = new URL(`/api/internal/payment-manual-approval/${id}`, requestUrl).toString();
    const receiptCallbackUrl = new URL(`/api/internal/payment-receipt-log/${id}`, requestUrl).toString();
    const signature = signatureFor(id, version, stored.proof_id);
    const receiptSignature = receiptLogSignature(id, version, stored.proof_id, attemptId);
    const receiptNumber = `SPSB-2027-${id.toUpperCase()}`;
    const form = new FormData();
    const fields: Record<string, string> = {
      id,
      version: String(version),
      proof_id: stored.proof_id,
      callback_url: callbackUrl,
      manual_callback_url: manualCallbackUrl,
      receipt_attempt_id: attemptId,
      receipt_callback_url: receiptCallbackUrl,
      receipt_signature: receiptSignature,
      callback_signature: signature,
      proof_mime: proof.mime,
      ocr_format: ocr.format,
      ocr_text: ocr.text,
      ocr_error: ocr.error,
      receipt_number: receiptNumber,
      email: participant.email,
      nama_anak: participant.nama_anak,
      nama_ortu: participant.nama_ortu,
      status_ortu: participant.status_ortu === "bapak" ? "Bapak" : "Ibu",
      jalur_pendaftaran: participant.jalur_pendaftaran === "askar" ? "Jalur Asatidz dan Karyawan (Askar) Tunas Ilmu" : "Jalur umum SPSB 2027",
      askar_anggota: ({ bapak: "Bapak", ibu: "Ibu", keduanya: "Bapak & Ibu" } as Record<string, string>)[participant.askar_anggota || ""] || "",
      askar_divisi_bapak: participant.askar_divisi_bapak || "",
      askar_divisi_ibu: participant.askar_divisi_ibu || "",
    };
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const extension = proof.mime === "image/jpeg" ? "jpg" : proof.mime === "image/png" ? "png" : "pdf";
    form.set("proofFile", new Blob([Buffer.from(proof.bytes)], { type: proof.mime }), `bukti-transfer.${extension}`);

    const response = await fetch(N8N_PAYMENT_WEBHOOK_URL, {
      method: "POST",
      headers: { "user-agent": "SPSB/1.0" },
      body: form,
      signal: AbortSignal.timeout(35_000),
    });
    if (!response.ok) {
      await recordLocalReceiptEvent(attemptId, "queue_failed", `Webhook n8n mengembalikan status HTTP ${response.status}.`);
      return "failed";
    }
    return "queued";
  } catch {
    console.error("Payment proof OCR webhook delivery failed");
    if (attemptId) await recordLocalReceiptEvent(attemptId, "queue_failed", "Pengiriman ke workflow n8n gagal sebelum proses dapat dimulai.").catch(() => {});
    return "failed";
  }
}

export async function acceptOcrPaymentVerification(id: string, input: {
  version: number;
  proof_id: string;
  signature: string;
  amount: number;
  payment_date: string;
  receipt_attempt_id: string;
  receipt_signature: string;
  execution_id?: string;
}) {
  const version = validVersion(input.version);
  const stored = await findParticipant(id);
  ensure(stored.version === version && stored.proof_id === input.proof_id, 409,
    "Data atau bukti pembayaran sudah berubah. Hasil OCR lama tidak diterapkan.");
  ensure(signatureMatches(input.signature, signatureFor(id, version, input.proof_id)), 403,
    "Tanda tangan hasil OCR tidak valid.");
  ensure(Number(input.amount) === REGISTRATION_FEE, 400,
    "Hasil OCR tidak memenuhi nominal pendaftaran.");
  const todayWib = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  ensure(isValidIsoDate(input.payment_date) && input.payment_date <= todayWib, 400,
    "Tanggal pembayaran pada bukti tidak valid.");

  const result = await verifyPayment(id, {
    version,
    status: "verified",
    date: input.payment_date,
    note: "Nominal Rp150.000 dan tanggal pembayaran terbaca OCR lokal; verifikasi otomatis.",
    amountConfirmed: true,
  }, OCR_REVIEWER);
  if (!result.newlyVerified) throw new ServiceError(409, "Pembayaran sudah diproses. Muat ulang data.");
  await recordPaymentReceiptEvent(id, {
    attempt_id: input.receipt_attempt_id,
    version,
    proof_id: input.proof_id,
    signature: input.receipt_signature,
    event: "payment_verified_ocr",
    method: "ocr",
    execution_id: input.execution_id,
    detail: `Nominal Rp${Number(input.amount).toLocaleString("id-ID")}, tanggal pembayaran ${input.payment_date}; status transaksi terbaca berhasil dan hasil OCR memenuhi ambang keterbacaan.`,
  });
  return { verified: true };
}

export async function acceptManualPaymentApproval(id: string, input: {
  version: number;
  proof_id: string;
  signature: string;
  payment_date?: string;
  receipt_attempt_id: string;
  receipt_signature: string;
  execution_id?: string;
}) {
  const version = validVersion(input.version);
  const stored = await findParticipant(id);
  ensure(stored.version === version && stored.proof_id === input.proof_id, 409,
    "Data atau bukti pembayaran sudah berubah. Persetujuan Telegram lama tidak diterapkan.");
  ensure(signatureMatches(input.signature, signatureFor(id, version, input.proof_id)), 403,
    "Tanda tangan persetujuan manual tidak valid.");
  const paymentDate = input.payment_date?.trim() || undefined;
  if (paymentDate) {
    const todayWib = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    ensure(isValidIsoDate(paymentDate) && paymentDate <= todayWib, 400,
      "Tanggal pembayaran pada persetujuan manual tidak valid.");
  }
  const result = await verifyPayment(id, {
    version,
    status: "verified",
    date: paymentDate,
    note: paymentDate
      ? "Disetujui manual oleh panitia melalui Telegram setelah mencocokkan bukti dengan catatan bank."
      : "Disetujui manual oleh panitia melalui Telegram setelah mencocokkan bukti dengan catatan bank; tanggal pada bukti tidak terbaca.",
    amountConfirmed: true,
    allowMissingDate: true,
  }, "Panitia (Telegram)");
  if (!result.newlyVerified) throw new ServiceError(409, "Pembayaran sudah diproses. Muat ulang data.");
  await recordPaymentReceiptEvent(id, {
    attempt_id: input.receipt_attempt_id,
    version,
    proof_id: input.proof_id,
    signature: input.receipt_signature,
    event: "payment_verified_manual",
    method: "telegram",
    execution_id: input.execution_id,
    detail: paymentDate
      ? "Panitia menyetujui bukti melalui Telegram setelah mencocokkannya dengan catatan bank."
      : "Panitia menyetujui bukti melalui Telegram setelah mencocokkannya dengan catatan bank; tanggal pada bukti tidak terbaca.",
  });
  return { verified: true, reviewed_by: "Panitia (Telegram)" };
}
