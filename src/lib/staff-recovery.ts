import { eq } from "drizzle-orm";
import { db } from "../db";
import { staffSessions, staffUsers } from "../db/schema";
import { audit, ensure, newId, ServiceError } from "./admin-common";
import { configuredAdminUsername, validatePassword } from "./staff-auth";

export async function recoverAdminFromHost(input: { username: string; password: string; create?: boolean }) {
  const username = configuredAdminUsername(input.username);
  validatePassword(input.password);
  const hash = await Bun.password.hash(input.password, { algorithm: "argon2id" });
  try {
    return await db.transaction(async tx => {
      if (input.create) {
        const id = newId();
        await tx.insert(staffUsers).values({ id, username, name: "Administrator pemulihan SPSB", role: "admin",
          password_hash: hash, active: 1, must_change_password: 1, created_at: new Date().toISOString() });
        await audit(tx, id, "pemulihan-host", "admin_recovery_created", { username });
        return { created: true, id };
      }
      const [user] = await tx.select().from(staffUsers).where(eq(staffUsers.username, username)).for("update");
      ensure(user, 404, "Username Admin tidak ditemukan. Periksa ADMIN_USERNAME. Gunakan --create hanya untuk membuat akun Admin pemulihan baru yang terpisah.");
      ensure(user.role === "admin", 403, "Akun tersebut bukan Admin. Pilih username Admin yang tepat, atau gunakan --create dengan username baru untuk membuat Admin pemulihan terpisah.");
      await tx.update(staffUsers).set({ password_hash: hash, active: 1, must_change_password: 1, version: user.version + 1 })
        .where(eq(staffUsers.id, user.id));
      await tx.delete(staffSessions).where(eq(staffSessions.user_id, user.id));
      await audit(tx, user.id, "pemulihan-host", "admin_recovered", { username });
      return { created: false, id: user.id };
    });
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    if (failure.code === "ER_DUP_ENTRY" || failure.cause?.code === "ER_DUP_ENTRY") {
      throw new ServiceError(409, "Username sudah digunakan. Jalankan tanpa --create untuk memulihkan akun Admin yang ada, atau pilih username pemulihan lain.");
    }
    throw error;
  }
}
