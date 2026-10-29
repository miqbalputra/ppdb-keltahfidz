import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, calonSantriWaitinglist as participants, participantProofs } from "../db/schema";
import { DATA_DIR, MAX_PAYMENT_PROOF_BYTES } from "../config";
import { decryptField, decryptPaymentProof, decryptSensitiveRecord, encryptField, encryptPaymentProof, encryptSensitiveRecord } from "./encryption";
import { detectPaymentProofMime } from "./payment-proof";
import { getSystemSettings } from "./settings";
import { isValidIsoDate, validateWaitinglist, type WaitinglistRecordInput } from "./validation";
import { audit, ensure, newId, ServiceError, type Transaction } from "./admin-common";

import { REGISTRATION_FEE } from "./payment-report";
export { REGISTRATION_FEE, paymentLabel } from "./payment-report";
export const PAYMENT_STATUSES = ["pending", "verified", "needs_correction"] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
type Participant = typeof participants.$inferSelect;
const proofDir = resolve(DATA_DIR, "payment-proofs");
function reasonText(reason: string) {
  const value = reason.trim();
  ensure(value.length >= 3 && value.length <= 1000, 400, "Alasan wajib diisi, 3–1.000 karakter.");
  return value;
}
export function validVersion(version: unknown): number {
  const n = Number(version); ensure(Number.isSafeInteger(n) && n > 0, 400, "Versi data wajib valid."); return n;
}
export async function findParticipant(id: string, tx: typeof db | Transaction = db, lock = false) {
  const query = tx.select().from(participants).where(eq(participants.id, id)).limit(1);
  const [row] = await (lock ? query.for("update") : query);
  ensure(row, 404, "Data pendaftar tidak ditemukan."); return row;
}
function assertVersion(row: Participant, version: number) {
  ensure(row.version === version, 409, "Data sudah diubah petugas lain. Muat ulang sebelum menyimpan.");
}
export async function readProof(row: Participant, proofId?: string) {
  const currentId = proofId || row.proof_id;
  let storageKey = `${row.id}.enc`, context = row.id, mime = row.bukti_transfer_mime;
  if (currentId) {
    const [proof] = await db.select().from(participantProofs)
      .where(and(eq(participantProofs.id, currentId), eq(participantProofs.participant_id, row.id))).limit(1);
    ensure(proof, 404, "Versi bukti transfer tidak ditemukan.");
    storageKey = proof.storage_key; context = proof.encryption_context; mime = proof.mime;
  }
  ensure(mime && ["image/jpeg", "image/png", "application/pdf"].includes(mime), 404, "Bukti transfer tidak ditemukan.");
  ensure(/^[a-f0-9]{32}\.enc$/.test(storageKey), 404, "Lokasi bukti tidak valid.");
  try {
    const bytes = decryptPaymentProof(await readFile(join(proofDir, storageKey)), context);
    ensure(detectPaymentProofMime(bytes) === mime, 404, "Berkas bukti transfer tidak valid.");
    return { bytes, mime };
  } catch { throw new ServiceError(404, "Bukti transfer tidak ditemukan atau tidak dapat dibuka."); }
}
async function writeProof(participantId: string, file: File, actor: string | null) {
  ensure(file.size > 0 && file.size <= MAX_PAYMENT_PROOF_BYTES, 400, "Bukti transfer wajib diisi, maksimal 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectPaymentProofMime(bytes);
  ensure(mime, 400, "Bukti transfer harus berupa JPG, PNG, atau PDF yang valid.");
  const id = newId(), storage_key = `${id}.enc`, encryption_context = `${participantId}:${id}`;
  await mkdir(proofDir, { recursive: true, mode: 0o700 }); await chmod(proofDir, 0o700);
  await writeFile(join(proofDir, storage_key), encryptPaymentProof(bytes, encryption_context), { flag: "wx", mode: 0o600 });
  return { id, participant_id: participantId, storage_key, encryption_context, mime,
    size: bytes.length, created_at: new Date().toISOString(), created_by: actor };
}
async function rememberLegacyProof(tx: Transaction, row: Participant) {
  if (row.proof_id || !row.bukti_transfer_mime) return;
  let size = 0;
  try {
    size = (await readProof(row)).bytes.length;
  } catch (error) { if (!(error instanceof ServiceError && error.status === 404)) throw error; }
  await tx.insert(participantProofs).values({ id: newId(), participant_id: row.id,
    storage_key: `${row.id}.enc`, encryption_context: row.id, mime: row.bukti_transfer_mime, size,
    created_at: row.created_at, created_by: null });
}
export async function createParticipant(values: WaitinglistRecordInput, file: File, actor: string | null) {
  const id = newId(); const proof = await writeProof(id, file, actor);
  try {
    await db.transaction(async tx => {
      await tx.insert(participants).values(encryptSensitiveRecord({ id, ...values,
        umur_terhitung_bulan: String(values.umur_terhitung_bulan), bukti_transfer_mime: proof.mime, proof_id: proof.id,
        updated_at: values.created_at, updated_by: actor }));
      await tx.insert(participantProofs).values(proof);
      await audit(tx, id, actor ?? "publik", "participant_created", { values, proofId: proof.id });
    });
  } catch (error) { await unlink(join(proofDir, proof.storage_key)).catch(() => {}); throw error; }
  return { id, version: 1 };
}
export async function updateParticipant(id: string, payload: Record<string, unknown>, file: File | undefined, actor: string) {
  const version = validVersion(payload.version), reason = reasonText(String(payload.reason ?? ""));
  const settings = await getSystemSettings();
  const proof = file && file.size ? await writeProof(id, file, actor) : null;
  try {
    return await db.transaction(async tx => {
      const stored = await findParticipant(id, tx, true); assertVersion(stored, version);
      ensure(!stored.deleted_at, 409, "Pulihkan peserta dari arsip sebelum mengubah data.");
      const before = decryptSensitiveRecord(stored);
      let values: WaitinglistRecordInput;
      try { values = validateWaitinglist(payload, settings, new Date(), { existingBirthdate: before.tanggal_lahir_anak }); }
      catch (error) { throw new ServiceError(400, (error as Error).message); }
      const sameBirthdate = before.tanggal_lahir_anak === values.tanggal_lahir_anak;
      if (!proof) await readProof(stored);
      else await rememberLegacyProof(tx, stored);
      const updates: typeof participants.$inferInsert = encryptSensitiveRecord({ id, ...values, created_at: stored.created_at,
        umur_terhitung_bulan: String(values.umur_terhitung_bulan), updated_at: new Date().toISOString(), updated_by: actor,
        version: stored.version + 1, ...(proof ? { proof_id: proof.id, bukti_transfer_mime: proof.mime,
          payment_status: "pending", payment_date: null, payment_reviewed_at: null, payment_reviewer: null, payment_note: null } : {}) });
      if (sameBirthdate) {
        updates.umur_terhitung_bulan = stored.umur_terhitung_bulan;
        updates.status_eligibility = stored.status_eligibility;
      }
      await tx.update(participants).set(updates).where(eq(participants.id, id));
      if (proof) await tx.insert(participantProofs).values(proof);
      await audit(tx, id, actor, proof ? "participant_updated_proof" : "participant_updated", { reason, before,
        after: { ...values, created_at: stored.created_at, proofId: proof?.id ?? stored.proof_id,
          ...(sameBirthdate ? { umur_terhitung_bulan: before.umur_terhitung_bulan, status_eligibility: before.status_eligibility } : {}),
          ...(proof ? { payment_status: "pending", payment_date: null, payment_reviewer: null, payment_reviewed_at: null, payment_note: null } : {}) } });
      return { saved: true, version: stored.version + 1 };
    });
  } catch (error) { if (proof) await unlink(join(proofDir, proof.storage_key)).catch(() => {}); throw error; }
}
export async function changeLifecycle(id: string, archived: boolean, version: number, reason: string, actor: string) {
  reason = reasonText(reason);
  await db.transaction(async tx => {
    const row = await findParticipant(id, tx, true); assertVersion(row, version);
    ensure(Boolean(row.deleted_at) !== archived, 409, archived ? "Pendaftar sudah diarsipkan." : "Pendaftar sudah aktif.");
    const now = new Date().toISOString();
    await tx.update(participants).set({ deleted_at: archived ? now : null, deleted_by: archived ? actor : null,
      updated_at: now, updated_by: actor, version: row.version + 1 }).where(eq(participants.id, id));
    await audit(tx, id, actor, archived ? "participant_archived" : "participant_restored", { reason });
  });
}
export function validatePaymentChange(row: Pick<Participant, "payment_status">, input: { status: string; date?: string; note?: string }, now = new Date()) {
  ensure(PAYMENT_STATUSES.includes(input.status as PaymentStatus), 400, "Status pembayaran tidak valid.");
  const note = (input.note ?? "").trim();
  ensure(note.length <= 1000, 400, "Catatan maksimal 1.000 karakter.");
  if (input.status === "needs_correction" || row.payment_status !== "pending") reasonText(note);
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  if (input.status === "verified") ensure(input.date && isValidIsoDate(input.date) && input.date <= today, 400, "Tanggal pembayaran wajib valid dan tidak boleh di masa depan (WIB).");
  return { status: input.status, date: input.status === "verified" ? input.date! : null, note };
}
export async function verifyPayment(id: string, input: { version: number; status: string; date?: string; note?: string; amountConfirmed?: boolean }, actor: string) {
  await db.transaction(async tx => {
    const row = await findParticipant(id, tx, true); assertVersion(row, validVersion(input.version));
    const change = validatePaymentChange(row, input);
    if (change.status === "verified") {
      ensure(input.amountConfirmed === true, 400, "Konfirmasikan nominal Rp150.000 sesuai bukti dan catatan bank.");
      await readProof(row);
    }
    const now = new Date().toISOString();
    await tx.update(participants).set({ payment_status: change.status, payment_date: change.date,
      payment_note: encryptField(change.note, "payment_note", id), payment_reviewed_at: now, payment_reviewer: actor,
      updated_at: now, updated_by: actor, version: row.version + 1 }).where(eq(participants.id, id));
    await audit(tx, id, actor, "payment_reviewed", { before: { status: row.payment_status, date: row.payment_date,
      reviewer: row.payment_reviewer, note: row.payment_note ? decryptField(row.payment_note, "payment_note", id) : "" },
      after: change, amount: change.status === "verified" ? REGISTRATION_FEE : 0, proofId: row.proof_id });
  });
  return { saved: true };
}
export async function participantHistory(id: string) {
  await findParticipant(id);
  const events = await db.select().from(auditEvents).where(eq(auditEvents.subject_id, id)).orderBy(desc(auditEvents.created_at), desc(auditEvents.id));
  const proofs = await db.select({ id: participantProofs.id, mime: participantProofs.mime, size: participantProofs.size,
    created_at: participantProofs.created_at, created_by: participantProofs.created_by }).from(participantProofs)
    .where(eq(participantProofs.participant_id, id)).orderBy(desc(participantProofs.created_at));
  return { events: events.map(event => ({ id: event.id, actor: event.actor, action: event.action, created_at: event.created_at,
    details: JSON.parse(decryptField(event.payload, "audit", event.id)) })), proofs };
}
