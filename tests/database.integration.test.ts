import { afterAll, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
let closeDb: (() => Promise<void>) | undefined;
let webhookServer: ReturnType<typeof Bun.serve> | undefined;
let originalFetch: typeof fetch | undefined;
const insertedIds: string[] = [];
let previousSettings: { cutoffDate: string; minAgeYears: number; minAgeMonths: number; whatsappGroupUrl: string; openingCountdownEnabled: boolean; openingDateTime: string } | undefined;

// This suite is opt-in because it runs destructive migrations against its database.
test.skipIf(!testDatabaseUrl)("MariaDB-backed public, admin, security, and notification flows", async () => {
  const databaseUrl = new URL(testDatabaseUrl!);
  if (!databaseUrl.pathname.toLowerCase().includes("test")) {
    throw new Error("TEST_DATABASE_URL must point to a dedicated database whose name includes 'test'.");
  }

  let turnstileRequests = 0;
  const webhookPayloads: Record<string, unknown>[] = [];
  let webhookAvailable = true;
  webhookServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      webhookPayloads.push(await request.json() as Record<string, unknown>);
      return new Response("mock n8n", { status: webhookAvailable ? 200 : 503 });
    },
  });

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = testDatabaseUrl!;
  process.env.DATA_DIR = "./data";
  process.env.ADMIN_USERNAME = "integration-admin";
  process.env.ADMIN_PASSWORD = "integration-test-password";
  process.env.APP_SECRET = "integration-test-session-secret-with-32-chars";
  process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.COOKIE_SECURE = "false";
  process.env.N8N_WEBHOOK_URL = `http://127.0.0.1:${webhookServer.port}/webhook`;
  process.env.TURNSTILE_SITE_KEY = "integration-site-key";
  process.env.TURNSTILE_SECRET_KEY = "integration-secret-key";
  process.env.CUTOFF_DATE = "2027-07-01";
  process.env.MIN_AGE_YEARS = "6";
  process.env.MIN_AGE_MONTHS = "6";
  process.env.WHATSAPP_GROUP_URL = "https://chat.whatsapp.com/integration-default";

  originalFetch = globalThis.fetch;
  const integrationFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      turnstileRequests += 1;
      const body = new URLSearchParams(init?.body as string);
      return Response.json({
        success: body.get("secret") === process.env.TURNSTILE_SECRET_KEY
          && body.get("response") === "valid-integration-token",
      });
    }
    return originalFetch!(input, init);
  };
  globalThis.fetch = Object.assign(integrationFetch, {
    preconnect: originalFetch.preconnect.bind(originalFetch),
  });

  try {
    const [{ db, closeDatabase }, { migrate }, { calonSantriWaitinglist }, { eq }, settingsModule] = await Promise.all([
      import("../src/db"),
      import("drizzle-orm/mysql2/migrator"),
      import("../src/db/schema"),
      import("drizzle-orm"),
      import("../src/lib/settings"),
    ]);
    closeDb = closeDatabase;
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
    await settingsModule.seedSystemSettings();
    previousSettings = await settingsModule.getSystemSettings();
    const testSettings = {
      cutoffDate: "2027-07-01",
      minAgeYears: 6,
      minAgeMonths: 6,
      whatsappGroupUrl: "https://chat.whatsapp.com/integration-default",
      openingCountdownEnabled: false,
      openingDateTime: "",
    };
    await settingsModule.saveSystemSettings(testSettings);

    const { decryptSensitiveRecord } = await import("../src/lib/encryption");
    const { encryptLegacyWaitinglistRows } = await import("../src/lib/security-migration");
    const legacyId = crypto.randomUUID().replaceAll("-", "");
    insertedIds.push(legacyId);
    await db.insert(calonSantriWaitinglist).values({
      id: legacyId,
      nama_ortu: "Legacy Integration Parent",
      status_ortu: "ibu",
      nama_anak: "Legacy Integration Child",
      tanggal_lahir_anak: "2021-01-01",
      umur_terhitung_bulan: "78",
      status_eligibility: "eligible",
      provinsi_id: "32",
      provinsi_nama: "Jawa Barat",
      kabupaten_id: "32.73",
      kabupaten_nama: "Kota Bandung",
      kecamatan_id: "32.73.01",
      kecamatan_nama: "Sukasari",
      desa_id: "32.73.01.1001",
      desa_nama: "Sukarasa",
      no_hp_wa: "6281234567890",
      email: "legacy-integration@example.com",
      konfirmasi_data: 1,
      created_at: new Date().toISOString(),
    });
    expect(await encryptLegacyWaitinglistRows()).toBe(1);
    expect(await encryptLegacyWaitinglistRows()).toBe(0);
    const encryptedLegacyRows = await db.select().from(calonSantriWaitinglist)
      .where(eq(calonSantriWaitinglist.id, legacyId));
    expect(encryptedLegacyRows[0]!.nama_anak).not.toContain("Legacy Integration Child");
    expect(decryptSensitiveRecord(encryptedLegacyRows[0]!).nama_anak).toBe("Legacy Integration Child");

    const { app } = await import("../src/index");
    const nonce = crypto.randomUUID().slice(0, 8);
    const proofSecret = `PAYMENT_PROOF_BYTES_ONLY_${nonce}`;
    const requestHeaders = {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.44",
    };
    const uploadHeaders = {
      host: "localhost",
      origin: "http://localhost",
      "cf-connecting-ip": "203.0.113.44",
    };
    const basePayload = {
      nama_ortu: `Integration Parent ${nonce}`,
      status_ortu: "ibu",
      nama_anak: `Integration Child ${nonce}`,
      jenis_kelamin: "putra",
      sekolah_asal: "TAUD Griya Qur'an",
      tanggal_lahir_anak: "2021-01-01",
      provinsi_id: "32",
      provinsi_nama: "Jawa Barat",
      kabupaten_id: "32.73",
      kabupaten_nama: "Kota Bandung",
      kecamatan_id: "32.73.01",
      kecamatan_nama: "Sukasari",
      desa_id: "32.73.01.1001",
      desa_nama: "Sukarasa",
      no_hp_wa: "0812-3456-7890",
      email: `integration-${nonce}@example.com`,
      konfirmasi_data: true,
      konfirmasi_bukti_transfer: true,
      konfirmasi_ketentuan_biaya: true,
      website: "",
    };
    const submissionForm = (payload: Record<string, unknown>) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(payload)) form.append(key, String(value));
      form.append("bukti_transfer", new Blob([`%PDF-1.7\n${String(payload.nama_anak)}\n${proofSecret}\n%%EOF`], { type: "application/pdf" }), "receipt.pdf");
      return form;
    };

    const readiness = await app.handle(new Request("http://localhost/readyz"));
    expect(readiness.status).toBe(200);
    expect(await readiness.json()).toEqual({ status: "ready", database: "connected" });

    const configResponse = await app.handle(new Request("http://localhost/api/config"));
    expect(configResponse.status).toBe(200);
    expect(await configResponse.json()).toMatchObject({
      eligibleBirthdate: "2021-01-01",
      turnstileSiteKey: "integration-site-key",
      whatsappGroupUrl: testSettings.whatsappGroupUrl,
      registrationOpen: true,
      openingCountdownEnabled: false,
    });

    const unverified = await app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: uploadHeaders,
      body: submissionForm(basePayload),
    }));
    expect(unverified.status).toBe(400);
    expect(turnstileRequests).toBe(0);

    const submit = async (name: string) => app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: uploadHeaders,
      body: submissionForm({ ...basePayload, nama_anak: name, turnstile_token: "valid-integration-token" }),
    }));

    const successResponse = await submit(basePayload.nama_anak);
    expect(successResponse.status).toBe(201);
    const successResult = await successResponse.json() as {
      id: string; emailStatus: string; whatsappGroupUrl: string;
    };
    insertedIds.push(successResult.id);
    expect(successResult).toMatchObject({
      emailStatus: "sent",
      whatsappGroupUrl: testSettings.whatsappGroupUrl,
    });
    expect(turnstileRequests).toBe(1);
    expect(webhookPayloads[0]).toMatchObject({
      nama_anak: basePayload.nama_anak,
      email: basePayload.email,
      status_eligibility: "eligible",
      whatsapp_group_url: testSettings.whatsappGroupUrl,
    });

    webhookAvailable = false;
    const failedEmailResponse = await submit(`Email Failure ${nonce}`);
    expect(failedEmailResponse.status).toBe(201);
    const failedEmailResult = await failedEmailResponse.json() as { id: string; emailStatus: string };
    insertedIds.push(failedEmailResult.id);
    expect(failedEmailResult.emailStatus).toBe("failed");
    expect(turnstileRequests).toBe(2);

    const storedRows = await db.select().from(calonSantriWaitinglist)
      .where(eq(calonSantriWaitinglist.id, successResult.id));
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]!.nama_anak).not.toContain("Integration Child");
    expect(storedRows[0]!.bukti_transfer_mime).toBe("application/pdf");
    expect(storedRows[0]!.konfirmasi_bukti_transfer).toBe(1);
    expect(storedRows[0]!.konfirmasi_ketentuan_biaya).toBe(1);
    expect(decryptSensitiveRecord(storedRows[0]!).nama_anak).toBe(basePayload.nama_anak);

    const login = await app.handle(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ username: "integration-admin", password: "integration-test-password" }),
    }));
    expect(login.status).toBe(200);
    const loginResult = await login.json() as { csrfToken: string };
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("psb_admin_session=");

    const adminHeaders = { ...requestHeaders, cookie };
    const proofUrl = `http://localhost/api/admin/waitinglist/${successResult.id}/proof`;
    expect((await app.handle(new Request(proofUrl))).status).toBe(401);
    const proofResponse = await app.handle(new Request(proofUrl, { headers: adminHeaders }));
    expect(proofResponse.status).toBe(200);
    expect(proofResponse.headers.get("content-type")).toBe("application/pdf");
    expect(proofResponse.headers.get("content-disposition")).toContain("attachment");
    expect(await proofResponse.text()).toContain(basePayload.nama_anak);

    const me = await app.handle(new Request("http://localhost/api/admin/me", { headers: adminHeaders }));
    expect(await me.json()).toMatchObject({ authenticated: true, username: "integration-admin" });

    const system = await app.handle(new Request("http://localhost/api/admin/system", { headers: adminHeaders }));
    expect(system.status).toBe(200);
    expect(await system.json()).toMatchObject({
      database: { status: "online" },
      integrations: { n8nConfigured: true, turnstileEnabled: true },
    });

    const registrationDate = new Date(Date.parse(storedRows[0]!.created_at) + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const query = new URLSearchParams({
      q: nonce,
      status: "eligible",
      page: "1",
      jenis_kelamin: "putra",
      tanggal_daftar_mulai: registrationDate,
      tanggal_daftar_sampai: registrationDate,
      tanggal_lahir_mulai: "2021-01-01",
      tanggal_lahir_sampai: "2021-01-01",
    });
    const exportQuery = new URLSearchParams(query);
    exportQuery.delete("page");
    const list = await app.handle(new Request(`http://localhost/api/admin/waitinglist?${query}`, { headers: adminHeaders }));
    expect(list.status).toBe(200);
    const listResult = await list.json() as { rows: Array<{ id: string; nama_anak: string }>; total: number };
    expect(listResult.total).toBe(2);
    expect(listResult.rows.map((row) => row.id)).toContain(successResult.id);

    const noGenderMatch = await app.handle(new Request(`http://localhost/api/admin/waitinglist?${new URLSearchParams({ q: nonce, jenis_kelamin: "putri", page: "1" })}`, { headers: adminHeaders }));
    expect(noGenderMatch.status).toBe(200);
    expect((await noGenderMatch.json() as { total: number }).total).toBe(0);

    const exportResponse = await app.handle(new Request(`http://localhost/api/admin/export.csv?${query}`, { headers: adminHeaders }));
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("content-type")).toContain("text/csv");
    expect(exportResponse.headers.get("cache-control")).toContain("no-store");
    const csv = await exportResponse.text();
    expect(csv).toContain(basePayload.nama_anak);
    expect(csv).toContain("Putra");
    expect(csv).toContain("TAUD Griya Qur'an");
    expect(csv).toContain("Setuju");

    const bulkXlsxResponse = await app.handle(new Request(`http://localhost/api/admin/export.xlsx?${exportQuery}`, { headers: adminHeaders }));
    expect(bulkXlsxResponse.status).toBe(200);
    expect(bulkXlsxResponse.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(bulkXlsxResponse.headers.get("content-disposition")).toContain(".xlsx");
    expect(bulkXlsxResponse.headers.get("cache-control")).toContain("no-store");
    const bulkBytes = Buffer.from(await bulkXlsxResponse.arrayBuffer());
    expect(bulkBytes.subarray(0, 2).toString()).toBe("PK");
    const bulkWorkbook = new ExcelJS.Workbook();
    await bulkWorkbook.xlsx.load(bulkBytes as unknown as Parameters<typeof bulkWorkbook.xlsx.load>[0]);
    const bulkSheet = bulkWorkbook.getWorksheet("Data Pendaftar")!;
    expect(bulkSheet.rowCount).toBe(3);
    const bulkValues: string[] = [];
    bulkSheet.eachRow((row) => row.eachCell((cell) => bulkValues.push(String(cell.value ?? ""))));
    expect(bulkValues).toContain(basePayload.nama_anak);
    expect(bulkValues.join(" ")).not.toContain(proofSecret);

    const noGenderMatchXlsx = await app.handle(new Request(
      `http://localhost/api/admin/export.xlsx?${new URLSearchParams({ q: nonce, jenis_kelamin: "putri" })}`,
      { headers: adminHeaders },
    ));
    expect(noGenderMatchXlsx.status).toBe(200);
    const noGenderWorkbook = new ExcelJS.Workbook();
    const noGenderBytes = Buffer.from(await noGenderMatchXlsx.arrayBuffer());
    await noGenderWorkbook.xlsx.load(noGenderBytes as unknown as Parameters<typeof noGenderWorkbook.xlsx.load>[0]);
    expect(noGenderWorkbook.getWorksheet("Data Pendaftar")!.rowCount).toBe(1);

    const invalidDateRange = await app.handle(new Request(
      "http://localhost/api/admin/export.xlsx?tanggal_daftar_mulai=2027-02-03&tanggal_daftar_sampai=2027-02-02",
      { headers: adminHeaders },
    ));
    expect(invalidDateRange.status).toBe(400);

    const participantPdfResponse = await app.handle(new Request(`http://localhost/api/admin/waitinglist/${successResult.id}/export.pdf`, { headers: adminHeaders }));
    expect(participantPdfResponse.status).toBe(200);
    expect(participantPdfResponse.headers.get("content-type")).toBe("application/pdf");
    expect(participantPdfResponse.headers.get("content-disposition")).toContain(".pdf");
    expect(participantPdfResponse.headers.get("cache-control")).toContain("no-store");
    const participantPdfBytes = Buffer.from(await participantPdfResponse.arrayBuffer());
    expect(participantPdfBytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(participantPdfBytes)).getPageCount()).toBeGreaterThan(0);
    expect(participantPdfBytes.toString("latin1")).not.toContain(proofSecret);

    const participantXlsxResponse = await app.handle(new Request(`http://localhost/api/admin/waitinglist/${successResult.id}/export.xlsx`, { headers: adminHeaders }));
    expect(participantXlsxResponse.status).toBe(200);
    expect(participantXlsxResponse.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(participantXlsxResponse.headers.get("content-disposition")).toContain(".xlsx");
    expect(participantXlsxResponse.headers.get("cache-control")).toContain("no-store");
    const participantWorkbook = new ExcelJS.Workbook();
    const participantWorkbookBytes = Buffer.from(await participantXlsxResponse.arrayBuffer());
    await participantWorkbook.xlsx.load(participantWorkbookBytes as unknown as Parameters<typeof participantWorkbook.xlsx.load>[0]);
    const participantSheet = participantWorkbook.getWorksheet("Data Peserta")!;
    expect(participantSheet.getColumn(2).values).toContain(basePayload.nama_anak);
    const participantValues: string[] = [];
    participantSheet.eachRow((row) => row.eachCell((cell) => participantValues.push(String(cell.value ?? ""))));
    expect(participantValues.join(" ")).not.toContain(proofSecret);

    const newGroupUrl = `https://chat.whatsapp.com/integration-${nonce}`;
    const updateSettings = await app.handle(new Request("http://localhost/api/admin/settings", {
      method: "PUT",
      headers: { ...adminHeaders, "x-csrf-token": loginResult.csrfToken },
      body: JSON.stringify({
        cutoffDate: "2027-07-01",
        minAgeYears: 6,
        minAgeMonths: 6,
        whatsappGroupUrl: newGroupUrl,
        openingCountdownEnabled: true,
        openingDateTime: "2030-01-01T10:00",
      }),
    }));
    expect(updateSettings.status).toBe(200);
    expect((await updateSettings.json() as { saved: boolean }).saved).toBe(true);
    expect(await (await app.handle(new Request("http://localhost/api/config"))).json())
      .toMatchObject({ whatsappGroupUrl: newGroupUrl, registrationOpen: false, openingCountdownEnabled: true, openingDateTime: "2030-01-01T10:00" });
    const closedSubmission = await app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: uploadHeaders,
      body: submissionForm({ ...basePayload, turnstile_token: "valid-integration-token" }),
    }));
    expect(closedSubmission.status).toBe(403);
    expect(await closedSubmission.json()).toMatchObject({ error: expect.stringContaining("belum dibuka") });
    expect(turnstileRequests).toBe(2);

    const logout = await app.handle(new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { ...adminHeaders, "x-csrf-token": loginResult.csrfToken },
      body: "{}",
    }));
    expect(logout.status).toBe(200);
  } finally {
    if (previousSettings) {
      const { saveSystemSettings } = await import("../src/lib/settings");
      await saveSystemSettings(previousSettings).catch(() => undefined);
    }
    if (insertedIds.length) {
      const [{ db }, { calonSantriWaitinglist }, { inArray }] = await Promise.all([
        import("../src/db"),
        import("../src/db/schema"),
        import("drizzle-orm"),
      ]);
      await db.delete(calonSantriWaitinglist)
        .where(inArray(calonSantriWaitinglist.id, insertedIds))
        .catch(() => undefined);
      const proofDir = resolve(process.env.DATA_DIR ?? "./data", "payment-proofs");
      await Promise.all(insertedIds.map((id) => unlink(join(proofDir, `${id}.enc`)).catch(() => undefined)));
    }
    webhookServer?.stop(true);
    webhookServer = undefined;
    if (originalFetch) globalThis.fetch = originalFetch;
    originalFetch = undefined;
    const closeDatabase = closeDb;
    closeDb = undefined;
    await closeDatabase?.();
  }
});

afterAll(async () => {
  webhookServer?.stop(true);
  if (originalFetch) globalThis.fetch = originalFetch;
  await closeDb?.();
});
