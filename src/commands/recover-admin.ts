import { ADMIN_PASSWORD, ADMIN_PASSWORD_CONFIGURED, ADMIN_USERNAME } from "../config";
import { closeDatabase } from "../db";
import { ensure, ServiceError } from "../lib/admin-common";
import { recoverAdminFromHost } from "../lib/staff-recovery";

// Host/Coolify access is required. No public password recovery endpoint is exposed.
try {
  const flags = process.argv.slice(2).filter(value => value !== "--");
  ensure(flags.length <= 1 && flags.every(value => value === "--create"), 400, "Gunakan bun run staff:recover atau bun run staff:recover -- --create.");
  ensure(Boolean(process.env.ADMIN_USERNAME?.trim()), 400, "Isi ADMIN_USERNAME di environment sebelum pemulihan.");
  ensure(ADMIN_PASSWORD_CONFIGURED, 400, "Isi ADMIN_PASSWORD baru di environment sebelum pemulihan.");
  const result = await recoverAdminFromHost({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD, create: flags.includes("--create") });
  console.info(result.created
    ? "Admin pemulihan baru berhasil dibuat. Login memakai kredensial environment, lalu ganti password di dashboard."
    : "Password akun Admin dipulihkan dan sesi akun tersebut dicabut. Login memakai kredensial environment, lalu ganti password di dashboard.");
} catch (error) {
  console.error(error instanceof ServiceError ? error.message : "Pemulihan gagal. Periksa koneksi database dan pastikan migrasi aplikasi sudah selesai.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
