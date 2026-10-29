import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "../db";
import { staffSessions, staffUsers } from "../db/schema";
import { ADMIN_USERNAME, ADMIN_PASSWORD, APP_SECRET } from "../config";
import { audit, ensure, newId, ServiceError } from "./admin-common";
import { readSessionCookie } from "./auth";

export type StaffRole = "admin" | "bendahara";
type UserRow = typeof staffUsers.$inferSelect;
export function publicUser(user: UserRow) {
  return { id: user.id, name: user.name, username: user.username, role: user.role as StaffRole,
    permissions: user.role === "admin"
      ? ["participants:read", "participants:write", "payments:review", "exports:read", "accounts:manage", "settings:manage"]
      : ["participants:read", "payments:review", "exports:read"],
    active: Boolean(user.active), mustChangePassword: Boolean(user.must_change_password), version: user.version };
}
export interface StaffSession {
  username: string; csrfToken: string; tokenHash: string; user: ReturnType<typeof publicUser>;
}
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const csrf = (token: string) => createHmac("sha256", APP_SECRET).update(`csrf:${token}`).digest("hex");
export function validatePassword(password: string) {
  ensure(password.length >= 16 && password.length <= 256, 400, "Password harus 16–256 karakter.");
}
function userValues(input: { name: string; username?: string; role: string }) {
  const name = input.name.trim();
  const username = input.username?.trim().toLowerCase();
  ensure(name.length > 0 && name.length <= 120, 400, "Nama petugas wajib diisi, maksimal 120 karakter.");
  if (username !== undefined) ensure(/^[a-z0-9._-]{3,80}$/.test(username), 400, "Username harus 3–80 huruf, angka, titik, garis bawah, atau tanda hubung.");
  ensure(["admin", "bendahara"].includes(input.role), 400, "Role tidak valid.");
  return { name, username, role: input.role };
}

export async function seedStaffAdmin() {
  const [existing] = await db.select({ id: staffUsers.id }).from(staffUsers).limit(1);
  if (existing) return;
  const values = userValues({ name: "Administrator SPSB", username: ADMIN_USERNAME, role: "admin" });
  await db.insert(staffUsers).values({ ...values, username: values.username!, id: newId(),
    password_hash: await Bun.password.hash(ADMIN_PASSWORD, { algorithm: "argon2id" }),
    must_change_password: 0, created_at: new Date().toISOString() })
    .onDuplicateKeyUpdate({ set: { username: values.username! } });
}

export async function authenticateStaff(username: string, password: string) {
  const [user] = await db.select().from(staffUsers).where(eq(staffUsers.username, username.trim().toLowerCase())).limit(1);
  // Always do a password hash operation, including for unknown users.
  if (!user) { await Bun.password.hash(password, { algorithm: "argon2id" }); return null; }
  if (!await Bun.password.verify(password, user.password_hash) || !user.active) return null;
  const token = randomBytes(32).toString("base64url");
  const hash = tokenHash(token);
  await db.transaction(async tx => {
    const [current] = await tx.select().from(staffUsers).where(eq(staffUsers.id, user.id)).for("update");
    ensure(current?.active && current.version === user.version, 401, "Akun berubah. Silakan login ulang.");
    await tx.delete(staffSessions).where(lt(staffSessions.expires_at, new Date().toISOString()));
    await tx.insert(staffSessions).values({ token_hash: hash, user_id: user.id,
      expires_at: new Date(Date.now() + 4 * 3600000).toISOString() });
  });
  return { token, csrfToken: csrf(token), user: publicUser(user) };
}

export async function getStaffSession(request: Request): Promise<StaffSession | null> {
  const token = readSessionCookie(request.headers.get("cookie"));
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = tokenHash(token);
  const [session] = await db.select({ user: staffUsers }).from(staffSessions)
    .innerJoin(staffUsers, eq(staffUsers.id, staffSessions.user_id))
    .where(and(eq(staffSessions.token_hash, hash), gt(staffSessions.expires_at, new Date().toISOString()), eq(staffUsers.active, 1))).limit(1);
  return session ? { username: session.user.username, csrfToken: csrf(token), tokenHash: hash, user: publicUser(session.user) } : null;
}
export async function revokeSession(session: StaffSession) {
  await db.delete(staffSessions).where(eq(staffSessions.token_hash, session.tokenHash));
}
export async function listStaff() {
  return (await db.select().from(staffUsers).orderBy(staffUsers.created_at)).map(publicUser);
}
export async function createStaff(input: { name: string; username: string; role: string; password: string; active?: boolean }, actor: string) {
  const values = userValues(input); validatePassword(input.password);
  const hash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
  const id = newId();
  try {
    await db.transaction(async tx => {
      await tx.insert(staffUsers).values({ id, ...values, username: values.username!, password_hash: hash, active: input.active === false ? 0 : 1,
        created_at: new Date().toISOString() });
      await audit(tx, id, actor, "user_created", { name: values.name, username: values.username, role: values.role });
    });
  } catch (error) {
    if ((error as any)?.cause?.code === "ER_DUP_ENTRY" || (error as any)?.code === "ER_DUP_ENTRY") throw new ServiceError(409, "Username sudah digunakan.");
    throw error;
  }
  return { id };
}
export async function updateStaff(id: string, input: { name: string; role: string; active: boolean; version: number }, actor: string) {
  const values = userValues(input);
  await db.transaction(async tx => {
    // Lock the small staff set in a stable order; concurrent demotions cannot remove the last admin.
    const users = await tx.select().from(staffUsers).orderBy(staffUsers.id).for("update");
    const user = users.find(row => row.id === id);
    ensure(user, 404, "Akun tidak ditemukan.");
    ensure(user.version === input.version, 409, "Akun sudah berubah. Muat ulang daftar akun.");
    const otherAdmins = users.filter(row => row.id !== id && row.active && row.role === "admin");
    ensure(!user.active || user.role !== "admin" || (input.active && input.role === "admin") || otherAdmins.length, 409, "Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan rolenya.");
    await tx.update(staffUsers).set({ name: values.name, role: values.role, active: input.active ? 1 : 0, version: user.version + 1 }).where(eq(staffUsers.id, id));
    await tx.delete(staffSessions).where(eq(staffSessions.user_id, id));
    await audit(tx, id, actor, "user_updated", { before: publicUser(user), after: { ...values, active: input.active } });
  });
}
export async function resetStaffPassword(id: string, password: string, actor: string, version?: number) {
  validatePassword(password);
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  await db.transaction(async tx => {
    const [user] = await tx.select().from(staffUsers).where(eq(staffUsers.id, id)).for("update");
    ensure(user, 404, "Akun tidak ditemukan.");
    if (version !== undefined) ensure(version === user.version, 409, "Akun sudah berubah. Muat ulang daftar akun.");
    await tx.update(staffUsers).set({ password_hash: hash, must_change_password: 1, version: user.version + 1 }).where(eq(staffUsers.id, id));
    await tx.delete(staffSessions).where(eq(staffSessions.user_id, id));
    await audit(tx, id, actor, "password_reset", {});
  });
}
export async function changeStaffPassword(session: StaffSession, currentPassword: string, password: string) {
  validatePassword(password);
  ensure(currentPassword !== password, 400, "Gunakan password baru yang berbeda.");
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  await db.transaction(async tx => {
    const [user] = await tx.select().from(staffUsers).where(eq(staffUsers.id, session.user.id)).for("update");
    ensure(user?.active && await Bun.password.verify(currentPassword, user.password_hash), 400, "Password saat ini tidak cocok.");
    await tx.update(staffUsers).set({ password_hash: hash, must_change_password: 0, version: user.version + 1 }).where(eq(staffUsers.id, user.id));
    await tx.delete(staffSessions).where(eq(staffSessions.user_id, user.id));
    await audit(tx, user.id, user.username, "password_changed", {});
  });
}
