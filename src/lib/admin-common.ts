import { randomBytes } from "node:crypto";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { encryptField } from "./encryption";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const newId = () => randomBytes(16).toString("hex");
export class ServiceError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}
export function ensure(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ServiceError(status, message);
}
export async function audit(tx: Transaction, subjectId: string, actor: string, action: string, payload: unknown) {
  const id = newId();
  await tx.insert(auditEvents).values({ id, subject_id: subjectId, actor, action,
    payload: encryptField(JSON.stringify(payload), "audit", id), created_at: new Date().toISOString() });
}
