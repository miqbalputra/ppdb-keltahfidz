import { expect, test } from "bun:test";
import { mkdtemp, rm, unlink, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";

test.skipIf(!process.env.TEST_DATABASE_URL)("dashboard roles, CRUD, financial audit, conflicts and 1000-record exports", async () => {
  const url = process.env.TEST_DATABASE_URL!;
  if (!new URL(url).pathname.toLowerCase().includes("test")) throw new Error("Use a dedicated test database.");
  const directory = await mkdtemp(join(tmpdir(), "spsb-dashboard-test-"));
  Object.assign(process.env, { DATABASE_URL: url, NODE_ENV: "test", DATA_DIR: directory,
    ADMIN_USERNAME: "integration-admin", ADMIN_PASSWORD: "integration-test-password", APP_SECRET: "integration-test-session-secret-with-32-chars",
    DATA_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", COOKIE_SECURE: "false", N8N_WEBHOOK_URL: "", TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "" });
  const [{ db, closeDatabase }, schema, { migrate }, { eq, inArray }, auth, settings, encryption] = await Promise.all([
    import("../src/db"), import("../src/db/schema"), import("drizzle-orm/mysql2/migrator"), import("drizzle-orm"),
    import("../src/lib/staff-auth"), import("../src/lib/settings"), import("../src/lib/encryption"),
  ]);
  const { calonSantriWaitinglist: participants, staffUsers, staffSessions, participantProofs, auditEvents } = schema;
  const ids: string[] = [], userIds: string[] = [];
  let bootstrapId: string | undefined;
  let previousSettings: Awaited<ReturnType<typeof settings.getSystemSettings>> | undefined;
  try {
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
    await auth.seedStaffAdmin(); await settings.seedSystemSettings(); previousSettings = await settings.getSystemSettings();
    await settings.saveSystemSettings({ cutoffDate: "2027-07-01", minAgeYears: 6, minAgeMonths: 6, whatsappGroupUrl: "", openingCountdownEnabled: true, openingDateTime: "2030-01-01T09:00" });
    const { app } = await import("../src/index");
    let loginAttempt = 0;
    type Login = { cookie: string; csrfToken: string; user: { id: string; version: number; mustChangePassword: boolean; role: string } };
    const login = async (username: string, password: string): Promise<Login> => {
      const response = await app.handle(new Request("http://localhost/api/admin/login", { method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json", "x-real-ip": `127.0.0.${++loginAttempt}` }, body: JSON.stringify({ username, password }) }));
      expect(response.status).toBe(200); return { ...await response.json() as any, cookie: response.headers.get("set-cookie")!.split(";")[0]! };
    };
    const call = (path: string, session?: Login, method = "GET", body?: unknown) => app.handle(new Request("http://localhost" + path, { method,
      headers: { host: "localhost", origin: "http://localhost", ...(session ? { cookie: session.cookie, "x-csrf-token": session.csrfToken } : {}), ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }));
    const admin = await login("integration-admin", "integration-test-password");
    expect((await call("/api/admin/me", admin)).status).toBe(200);
    const users = (await (await call("/api/admin/users", admin)).json() as any).users;
    const primary = users.find((u: any) => u.username === "integration-admin");
    bootstrapId = primary.id;
    expect(JSON.stringify(users)).not.toContain("password_hash");
    expect((await call(`/api/admin/users/${primary.id}`, admin, "PUT", { name: primary.name, role: "bendahara", active: true, version: primary.version })).status).toBe(409);
    const nonce = crypto.randomUUID().replaceAll("-", "").slice(0, 12), username = "treasurer-" + nonce;
    const created = await call("/api/admin/users", admin, "POST", { name: "Bendahara Uji", username, role: "bendahara", password: "temporary-password-12345" });
    expect(created.status).toBe(201); const userId = (await created.json() as any).id; userIds.push(userId);
    expect((await call("/api/admin/users", admin, "POST", { name: "Duplikat", username, role: "bendahara", password: "temporary-password-12345" })).status).toBe(409);
    const [storedUser] = await db.select().from(staffUsers).where(eq(staffUsers.id, userId)); expect(storedUser!.password_hash).toStartWith("$argon2id$");
    let treasurer = await login(username, "temporary-password-12345"); expect(treasurer.user.mustChangePassword).toBe(true);
    expect((await call("/api/admin/waitinglist", treasurer)).status).toBe(403);
    expect((await call("/api/admin/password", treasurer, "POST", { currentPassword: "temporary-password-12345", password: "new-treasurer-password-12345" })).status).toBe(200);
    expect((await (await call("/api/admin/me", treasurer)).json() as any).authenticated).toBe(false);
    treasurer = await login(username, "new-treasurer-password-12345");
    for (const path of ["/api/admin/users", "/api/admin/settings", "/api/admin/system", "/api/admin/brochure"]) {
      expect((await call(path, treasurer)).status).toBe(403);
      expect((await call(path + "/", treasurer)).status).toBe(403);
    }

    const base = { nama_ortu: "Orang Tua " + nonce, status_ortu: "ibu", nama_anak: "Santri " + nonce, jenis_kelamin: "putri", sekolah_asal: "TK Uji", tanggal_lahir_anak: "2020-01-01",
      provinsi_id: "32", provinsi_nama: "Jawa Barat", kabupaten_id: "32.73", kabupaten_nama: "Kota Bandung", kecamatan_id: "32.73.01", kecamatan_nama: "Sukasari", desa_id: "32.73.01.1001", desa_nama: "Sukarasa", no_hp_wa: "081234567890", email: "uji@example.test",
      konfirmasi_data: "true", konfirmasi_bukti_transfer: "true", konfirmasi_ketentuan_biaya: "true" };
    const form = (extra: Record<string, string> = {}, proof = true) => {
      const data = new FormData(); for (const [key, value] of Object.entries({ ...base, ...extra })) data.append(key, value);
      if (proof) data.append("bukti_transfer", new Blob(["%PDF-1.7\nPROOF-PRIVATE-" + nonce + "\n%%EOF"], { type: "application/pdf" }), "proof.pdf"); return data;
    };
    expect((await call("/api/admin/waitinglist", treasurer, "POST", form())).status).toBe(403);
    expect((await call("/api/admin/waitinglist", admin, "POST", form({}, false))).status).toBe(400);
    expect((await call("/api/admin/waitinglist", admin, "POST", form({ tanggal_lahir_anak: "2023-01-01" }))).status).toBe(400);
    const added = await call("/api/admin/waitinglist", admin, "POST", form()); expect(added.status).toBe(201);
    const id = (await added.json() as any).id; ids.push(id);
    const detail = async () => await (await call(`/api/admin/waitinglist/${id}`, admin)).json() as any;
    let participant = await detail(); expect(participant.payment_status).toBe("pending"); expect(participant.version).toBe(1);
    expect((await call(`/api/admin/waitinglist/${id}/proof`, treasurer)).status).toBe(200);
    const paidDate = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const [savedProof] = await db.select().from(participantProofs).where(eq(participantProofs.participant_id, id));
    const proofPath = join(directory, "payment-proofs", savedProof!.storage_key), encryptedProof = await readFile(proofPath);
    await unlink(proofPath);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: 1, status: "verified", date: paidDate, amountConfirmed: true })).status).toBe(404);
    expect((await detail()).payment_status).toBe("pending");
    await writeFile(proofPath, encryptedProof);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: 1, status: "verified", date: paidDate })).status).toBe(400);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: 1, status: "needs_correction" })).status).toBe(400);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: 1, status: "verified", date: "2099-01-01", amountConfirmed: true })).status).toBe(400);
    const concurrent = await Promise.all([admin, treasurer].map(actor => call(`/api/admin/waitinglist/${id}/payment`, actor, "PUT", { version: 1, status: "verified", date: paidDate, amountConfirmed: true })));
    expect(concurrent.map(r => r.status).sort()).toEqual([200, 409]);
    participant = await detail(); expect(participant.payment_status).toBe("verified");
    const query = "?q=" + nonce;
    let report = await (await call("/api/admin/report" + query, treasurer)).json() as any;
    expect(report.payments.verifiedAmount).toBe(150000); expect(report.payments.verified).toBe(1);
    expect((await call(`/api/admin/waitinglist/${id}`, treasurer, "PUT", form({ version: "2", reason: "Koreksi kontak" }, false))).status).toBe(403);
    expect((await call(`/api/admin/waitinglist/${id}`, admin, "PUT", form({ version: "1", reason: "Koreksi kontak" }, false))).status).toBe(409);
    const originalTime = participant.created_at, originalAge = participant.umur_terhitung_bulan;
    expect((await call(`/api/admin/waitinglist/${id}`, admin, "PUT", form({ version: "2", reason: "Koreksi kontak", email: "baru@example.test" }, false))).status).toBe(200);
    participant = await detail(); expect(participant.created_at).toBe(originalTime); expect(participant.umur_terhitung_bulan).toBe(originalAge); expect(participant.payment_status).toBe("verified");
    expect((await call(`/api/admin/waitinglist/${id}`, admin, "PUT", form({ version: "3", reason: "Ganti bukti transfer" }))).status).toBe(200);
    participant = await detail(); expect(participant.payment_status).toBe("pending"); expect(participant.payment_date).toBeNull();
    const history = await (await call(`/api/admin/waitinglist/${id}/history`, treasurer)).json() as any;
    expect(history.proofs).toHaveLength(2); expect(history.events.some((e: any) => e.action === "payment_reviewed")).toBe(true);
    expect((await call(`/api/admin/waitinglist/${id}/proof?version=${history.proofs[1].id}`, treasurer)).status).toBe(200);
    const rawAudit = await db.select().from(auditEvents).where(eq(auditEvents.subject_id, id)); expect(JSON.stringify(rawAudit)).not.toContain(base.nama_anak);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: 4, status: "verified", date: paidDate, amountConfirmed: true })).status).toBe(200);
    expect((await call(`/api/admin/waitinglist/${id}/archive`, treasurer, "POST", { version: 5, reason: "Arsip uji" })).status).toBe(403);
    expect((await call(`/api/admin/waitinglist/${id}/archive/`, treasurer, "POST", { version: 5, reason: "Arsip uji" })).status).toBe(403);
    expect((await call(`/api/admin/waitinglist/${id}/archive`, admin, "POST", { version: 5, reason: "Arsip uji" })).status).toBe(200);
    expect((await (await call("/api/admin/report" + query, admin)).json() as any).total).toBe(0);
    report = await (await call("/api/admin/report" + query + "&view=all", admin)).json() as any; expect(report.payments.verifiedAmount).toBe(150000);
    expect((await call(`/api/admin/waitinglist/${id}/export.pdf`, treasurer)).status).toBe(200);
    expect((await call(`/api/admin/waitinglist/${id}/restore`, admin, "POST", { version: 6, reason: "Pulihkan uji" })).status).toBe(200);

    // The same filtered dataset must drive 1,000 participant rows, financial totals and both export formats.
    const { validateWaitinglist } = await import("../src/lib/validation");
    const values = validateWaitinglist(base, { cutoffDate: "2027-07-01", minAgeYears: 6, minAgeMonths: 6, whatsappGroupUrl: "", openingCountdownEnabled: false, openingDateTime: "" });
    for (let offset = 0; offset < 999; offset += 100) {
      const rows = Array.from({ length: Math.min(100, 999 - offset) }, (_, i) => {
        const rowId = crypto.randomUUID().replaceAll("-", ""); ids.push(rowId); const verified = (offset + i) % 3 === 0;
        return encryption.encryptSensitiveRecord({ id: rowId, ...values, nama_anak: `Santri ${nonce} ${offset + i}`, umur_terhitung_bulan: String(values.umur_terhitung_bulan), payment_status: verified ? "verified" : "pending", payment_date: verified ? paidDate : null, bukti_transfer_mime: null });
      });
      await db.insert(participants).values(rows);
    }
    report = await (await call("/api/admin/report" + query, admin)).json() as any;
    expect(report.total).toBe(1000); expect(report.payments.verified).toBe(334); expect(report.payments.verifiedAmount).toBe(334 * 150000);
    expect(report.payments.trend.buckets.reduce((sum: number, row: any) => sum + row.amount, 0)).toBe(334 * 150000);
    const excelResponse = await call("/api/admin/export.xlsx" + query, treasurer); expect(excelResponse.status).toBe(200);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(await excelResponse.arrayBuffer()) as never); expect(workbook.getWorksheet("Data Pendaftar")!.rowCount).toBe(1001);
    const pdfResponse = await call("/api/admin/export.pdf" + query, treasurer); expect(pdfResponse.status).toBe(200); expect((await PDFDocument.load(await pdfResponse.arrayBuffer())).getPageCount()).toBeGreaterThan(20);
    for (const path of ["/api/admin/report.pdf", "/api/admin/payments/export.pdf", "/api/admin/payments/export.xlsx"]) expect((await call(path + query + "&payment_status=verified", treasurer)).status).toBe(200);
    participant = await detail();
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: participant.version, status: "needs_correction", note: "Rekonsiliasi ulang dengan catatan bank" })).status).toBe(200);
    participant = await detail();
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: participant.version, status: "pending" })).status).toBe(400);
    expect((await call(`/api/admin/waitinglist/${id}/payment`, treasurer, "PUT", { version: participant.version, status: "pending", note: "Menunggu konfirmasi ulang" })).status).toBe(200);
    const me = await (await call("/api/admin/users", admin)).json() as any; const u = me.users.find((v: any) => v.id === userId);
    expect((await call(`/api/admin/users/${userId}`, admin, "PUT", { name: u.name, role: "bendahara", active: false, version: u.version })).status).toBe(200);
    expect((await call("/api/admin/waitinglist", treasurer)).status).toBe(401);
    await auth.resetStaffPassword(userId, "another-password-12345", "integration-admin");
    const [disabled] = await db.select().from(staffUsers).where(eq(staffUsers.id, userId));
    await auth.updateStaff(userId, { name: disabled!.name, role: "bendahara", active: true, version: disabled!.version }, "integration-admin");
    const resetLogin = await login(username, "another-password-12345"); expect(resetLogin.user.mustChangePassword).toBe(true);
    await auth.revokeSession((await auth.getStaffSession(new Request("http://localhost", { headers: { cookie: resetLogin.cookie } })))!);
    expect((await call("/api/admin/waitinglist", resetLogin)).status).toBe(401);
    const extraAdmin = await auth.createStaff({ name: "Admin kedua", username: "admin-" + nonce, password: "another-admin-password-12345", role: "admin" }, "integration-admin"); userIds.push(extraAdmin.id);
    const [rootNow] = await db.select().from(staffUsers).where(eq(staffUsers.id, primary.id));
    const changes = await Promise.allSettled([
      auth.updateStaff(primary.id, { name: primary.name, role: "bendahara", active: true, version: rootNow!.version }, "integration-admin"),
      auth.updateStaff(extraAdmin.id, { name: "Admin kedua", role: "bendahara", active: true, version: 1 }, "integration-admin"),
    ]);
    expect(changes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = changes.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
  } finally {
    if (bootstrapId) await db.update(staffUsers).set({ role: "admin", active: 1 }).where(eq(staffUsers.id, bootstrapId));
    if (previousSettings) await settings.saveSystemSettings(previousSettings);
    if (ids.length) {
      const proofs = await db.select().from(participantProofs).where(inArray(participantProofs.participant_id, ids));
      await db.delete(participantProofs).where(inArray(participantProofs.participant_id, ids));
      await db.delete(auditEvents).where(inArray(auditEvents.subject_id, ids));
      await db.delete(participants).where(inArray(participants.id, ids));
      await Promise.all(proofs.map(p => unlink(join(directory, "payment-proofs", p.storage_key)).catch(() => {})));
    }
    if (userIds.length) { await db.delete(staffSessions).where(inArray(staffSessions.user_id, userIds)); await db.delete(staffUsers).where(inArray(staffUsers.id, userIds)); await db.delete(auditEvents).where(inArray(auditEvents.subject_id, userIds)); }
    await closeDatabase(); await rm(directory, { recursive: true, force: true });
  }
}, 120000);
