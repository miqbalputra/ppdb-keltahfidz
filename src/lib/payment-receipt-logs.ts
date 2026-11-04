import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "../db";
import { calonSantriWaitinglist, paymentReceiptAttempts, paymentReceiptEvents } from "../db/schema";
import { APP_SECRET } from "../config";
import { decryptField, decryptSensitiveRecord, encryptField } from "./encryption";
import { ensure, newId, type Transaction } from "./admin-common";
import { validVersion } from "./participants";

export const RECEIPT_EVENTS = [
  "queued",
  "not_configured",
  "queue_failed",
  "telegram_proof_sent",
  "telegram_proof_failed",
  "manual_review_required",
  "manual_review_not_approved",
  "payment_verified_ocr",
  "payment_verified_manual",
  "email_sent",
  "email_failed",
] as const;
export type ReceiptEvent = typeof RECEIPT_EVENTS[number];
export type ReceiptMethod = "ocr" | "telegram";

const eventStatus: Record<ReceiptEvent, string> = {
  queued: "queued",
  not_configured: "not_configured",
  queue_failed: "failed",
  telegram_proof_sent: "waiting_approval",
  telegram_proof_failed: "failed",
  manual_review_required: "waiting_approval",
  manual_review_not_approved: "not_approved",
  payment_verified_ocr: "payment_verified",
  payment_verified_manual: "payment_verified",
  email_sent: "sent",
  email_failed: "failed",
};

export function receiptLogSignature(participantId: string, version: number, proofId: string, attemptId: string) {
  return createHmac("sha256", APP_SECRET)
    .update(`spsb-payment-receipt-log:${participantId}:${version}:${proofId}:${attemptId}`)
    .digest("hex");
}

function signatureMatches(received: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const receivedBytes = Buffer.from(received, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes);
}

async function insertEvent(tx: Transaction, input: {
  id?: string;
  attemptId: string;
  participantId: string;
  event: ReceiptEvent;
  actor: string;
  executionId?: string;
  detail?: string;
  createdAt: string;
}) {
  const id = input.id ?? newId();
  const payload = encryptField(JSON.stringify({ detail: input.detail ?? "" }), "receipt_event", id);
  await tx.insert(paymentReceiptEvents).values({
    id,
    attempt_id: input.attemptId,
    participant_id: input.participantId,
    event: input.event,
    actor: input.actor,
    execution_id: input.executionId || null,
    payload,
    created_at: input.createdAt,
  });
  return id;
}

export async function createPaymentReceiptAttempt(participantId: string, version: number, proofId: string) {
  const attemptId = newId();
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    await tx.insert(paymentReceiptAttempts).values({
      id: attemptId,
      participant_id: participantId,
      proof_id: proofId,
      participant_version: validVersion(version),
      status: "queued",
      method: null,
      execution_id: null,
      gmail_message_id: null,
      last_error: null,
      created_at: now,
      updated_at: now,
      sent_at: null,
    });
    await insertEvent(tx, { attemptId, participantId, event: "queued", actor: "Aplikasi SPSB", detail: "Bukti pendaftaran masuk ke antrean pemeriksaan OCR dan tanda terima.", createdAt: now });
  });
  return attemptId;
}

export async function recordLocalReceiptEvent(attemptId: string, event: "not_configured" | "queue_failed", detail: string) {
  await db.transaction(async tx => {
    const [attempt] = await tx.select().from(paymentReceiptAttempts).where(eq(paymentReceiptAttempts.id, attemptId)).limit(1).for("update");
    ensure(attempt, 404, "Antrean tanda terima tidak ditemukan.");
    const now = new Date().toISOString();
    await tx.update(paymentReceiptAttempts).set({
      status: eventStatus[event],
      last_error: encryptField(detail.slice(0, 2000), "receipt_error", attemptId),
      updated_at: now,
    }).where(eq(paymentReceiptAttempts.id, attemptId));
    await insertEvent(tx, { attemptId, participantId: attempt.participant_id, event, actor: "Aplikasi SPSB", detail: detail.slice(0, 2000), createdAt: now });
  });
}

export async function recordPaymentReceiptEvent(participantId: string, input: {
  attempt_id: string;
  version: number;
  proof_id: string;
  signature: string;
  event: string;
  method?: string;
  execution_id?: string;
  message_id?: string;
  detail?: string;
}) {
  ensure(RECEIPT_EVENTS.includes(input.event as ReceiptEvent), 400, "Jenis peristiwa tanda terima tidak valid.");
  const event = input.event as ReceiptEvent;
  const version = validVersion(input.version);
  const method = input.method === undefined ? undefined : input.method as ReceiptMethod;
  ensure(method === undefined || method === "ocr" || method === "telegram", 400, "Metode tanda terima tidak valid.");
  const executionId = (input.execution_id ?? "").trim();
  const messageId = (input.message_id ?? "").trim();
  const detail = (input.detail ?? "").trim().slice(0, 2000);
  ensure(executionId.length > 0 && executionId.length <= 80 && messageId.length <= 160, 400, "Identitas eksekusi atau email tidak valid.");

  let duplicate = false;
  await db.transaction(async tx => {
    const [attempt] = await tx.select().from(paymentReceiptAttempts)
      .where(and(eq(paymentReceiptAttempts.id, input.attempt_id), eq(paymentReceiptAttempts.participant_id, participantId)))
      .limit(1).for("update");
    ensure(attempt && attempt.proof_id === input.proof_id && attempt.participant_version === version, 409,
      "Log tidak cocok dengan bukti dan versi pendaftaran yang memulai proses.");
    ensure(signatureMatches(input.signature, receiptLogSignature(participantId, version, attempt.proof_id, attempt.id)), 403,
      "Tanda tangan log tanda terima tidak valid.");

    const id = createHash("sha256").update(`${attempt.id}:${event}:${executionId}`).digest("hex").slice(0, 32);
    const [existing] = await tx.select({ id: paymentReceiptEvents.id }).from(paymentReceiptEvents)
      .where(eq(paymentReceiptEvents.id, id)).limit(1);
    if (existing) { duplicate = true; return; }

    const verifiedEvents: ReceiptEvent[] = ["payment_verified_ocr", "payment_verified_manual"];
    if (event === "telegram_proof_sent") ensure(["queued", "waiting_approval"].includes(attempt.status), 409, "Antrean ini tidak sedang mengirim bukti ke Telegram.");
    if (event === "telegram_proof_failed") ensure(["queued", "waiting_approval"].includes(attempt.status), 409, "Antrean ini tidak sedang mengirim bukti ke Telegram.");
    if (event === "manual_review_required") ensure(["queued", "waiting_approval"].includes(attempt.status), 409, "Antrean ini tidak sedang menunggu pemeriksaan manual.");
    if (event === "manual_review_not_approved") ensure(attempt.status === "waiting_approval", 409, "Antrean ini tidak sedang menunggu hasil persetujuan manual.");
    if (verifiedEvents.includes(event)) ensure(["queued", "waiting_approval", "payment_verified"].includes(attempt.status), 409, "Status tanda terima sudah berubah.");
    if (event === "email_sent" || event === "email_failed") ensure(attempt.status === "payment_verified", 409, "Pembayaran belum tercatat terverifikasi untuk pengiriman email.");

    const now = new Date().toISOString();
    const actor = event === "payment_verified_manual" || event === "manual_review_not_approved" ? "Panitia melalui Telegram"
      : event === "payment_verified_ocr" ? "OCR lokal SPSB"
      : event.startsWith("email_") ? "Gmail melalui n8n"
        : event.startsWith("telegram_proof_") || event.startsWith("manual_review_") ? "Telegram melalui n8n" : "Workflow n8n";
    await insertEvent(tx, { id, attemptId: attempt.id, participantId, event, actor, executionId, detail, createdAt: now });
    const failed = event === "email_failed" || event === "telegram_proof_failed";
    const attemptMethod = method ?? (event === "payment_verified_manual" || event === "manual_review_required" ? "telegram" : event === "payment_verified_ocr" ? "ocr" : undefined);
    await tx.update(paymentReceiptAttempts).set({
      status: eventStatus[event],
      ...(attemptMethod ? { method: attemptMethod } : {}),
      ...(executionId ? { execution_id: executionId } : {}),
      ...(messageId ? { gmail_message_id: messageId } : {}),
      ...(failed ? { last_error: encryptField(detail || (event === "email_failed" ? "Gmail gagal memproses tanda terima." : "Telegram gagal meneruskan bukti transfer."), "receipt_error", attempt.id) } : {}),
      ...(event === "email_sent" ? { sent_at: now, last_error: null } : {}),
      updated_at: now,
    }).where(eq(paymentReceiptAttempts.id, attempt.id));
  });
  return { recorded: true, duplicate };
}

export type ReceiptLogQuery = { page?: string; page_size?: string; status?: string; method?: string; q?: string };

export async function listPaymentReceiptLogs(query: ReceiptLogQuery) {
  const page = Math.max(1, Math.min(100_000, Number.parseInt(query.page ?? "1", 10) || 1));
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(query.page_size ?? "25", 10) || 25));
  const status = query.status && query.status !== "all" ? query.status : "";
  const method = query.method && query.method !== "all" ? query.method : "";
  const search = (query.q ?? "").trim().toLocaleLowerCase("id-ID").slice(0, 120);
  const filters: SQL[] = [];
  if (status) filters.push(eq(paymentReceiptAttempts.status, status));
  if (method) filters.push(eq(paymentReceiptAttempts.method, method));
  const rows = await db.select({ attempt: paymentReceiptAttempts, participant: calonSantriWaitinglist })
    .from(paymentReceiptAttempts)
    .leftJoin(calonSantriWaitinglist, eq(paymentReceiptAttempts.participant_id, calonSantriWaitinglist.id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(paymentReceiptAttempts.created_at));
  const records = rows.map(({ attempt, participant }) => {
    const participantData = participant ? decryptSensitiveRecord(participant as unknown as Record<string, unknown>) : null;
    return { attempt, participant: participantData };
  }).filter(row => !search || [row.attempt.participant_id, row.participant?.nama_anak, row.participant?.nama_ortu, row.participant?.email]
    .some(value => String(value ?? "").toLocaleLowerCase("id-ID").includes(search)));
  const total = records.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const selected = records.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const attemptIds = selected.map(row => row.attempt.id);
  const events = attemptIds.length ? await db.select().from(paymentReceiptEvents)
    .where(inArray(paymentReceiptEvents.attempt_id, attemptIds))
    .orderBy(paymentReceiptEvents.created_at) : [];
  const grouped = new Map<string, Array<{ id: string; event: string; actor: string; execution_id: string | null; detail: string; created_at: string }>>();
  for (const event of events) {
    let detail = "";
    try { detail = String((JSON.parse(decryptField(event.payload, "receipt_event", event.id)) as { detail?: string }).detail ?? ""); }
    catch { detail = "Detail log tidak dapat dibuka."; }
    const list = grouped.get(event.attempt_id) ?? [];
    list.push({ id: event.id, event: event.event, actor: event.actor, execution_id: event.execution_id, detail, created_at: event.created_at });
    grouped.set(event.attempt_id, list);
  }
  return {
    page: currentPage,
    page_size: pageSize,
    pages: pageCount,
    total,
    summary: records.reduce((acc, row) => { acc[row.attempt.status] = (acc[row.attempt.status] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    items: selected.map(({ attempt, participant }) => ({
      id: attempt.id,
      participant_id: attempt.participant_id,
      proof_id: attempt.proof_id,
      participant_version: attempt.participant_version,
      nama_anak: participant?.nama_anak ?? "Pendaftar tidak ditemukan",
      nama_ortu: participant?.nama_ortu ?? "",
      email: participant?.email ?? "",
      jalur_pendaftaran: participant?.jalur_pendaftaran ?? "umum",
      archived: Boolean(participant?.deleted_at),
      status: attempt.status,
      method: attempt.method,
      execution_id: attempt.execution_id,
      gmail_message_id: attempt.gmail_message_id,
      last_error: attempt.last_error ? (() => { try { return decryptField(attempt.last_error!, "receipt_error", attempt.id); } catch { return "Detail error tidak dapat dibuka."; } })() : "",
      created_at: attempt.created_at,
      updated_at: attempt.updated_at,
      sent_at: attempt.sent_at,
      events: grouped.get(attempt.id) ?? [],
    })),
  };
}
