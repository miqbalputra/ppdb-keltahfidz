import { eq } from "drizzle-orm";
import { ADMIN_PASSWORD, ADMIN_USERNAME } from "../config";
import { db, closeDatabase } from "../db";
import { staffSessions, staffUsers } from "../db/schema";
import { audit, ensure } from "../lib/admin-common";
import { seedStaffAdmin, validatePassword } from "../lib/staff-auth";

// Host/Coolify access is required. No public password recovery endpoint is exposed.
try {
  validatePassword(ADMIN_PASSWORD);
  ensure(Boolean(process.env.ADMIN_PASSWORD), 400, "Isi ADMIN_PASSWORD baru di environment sebelum pemulihan.");
  await seedStaffAdmin();
  const hash = await Bun.password.hash(ADMIN_PASSWORD, { algorithm: "argon2id" });
  await db.transaction(async tx => {
    const [user] = await tx.select().from(staffUsers).where(eq(staffUsers.username, ADMIN_USERNAME.toLowerCase())).for("update");
    ensure(user, 404, "Username Admin tidak ditemukan.");
    await tx.update(staffUsers).set({ password_hash: hash, role: "admin", active: 1, must_change_password: 1, version: user.version + 1 }).where(eq(staffUsers.id, user.id));
    await tx.delete(staffSessions).where(eq(staffSessions.user_id, user.id));
    await audit(tx, user.id, "pemulihan-host", "admin_recovered", {});
  });
  console.info("Akun Admin dipulihkan. Login memakai password environment, lalu ganti password di dashboard.");
} finally { await closeDatabase(); }
