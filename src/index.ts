import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Elysia, t } from "elysia";
import { count, desc, eq, gt, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import {
  ADMIN_PASSWORD_CONFIGURED,
  APP_SECRET_CONFIGURED,
  assertProductionSecurityConfig,
  COOKIE_SECURE,
  DATA_DIR,
  HOST,
  MAX_PAYMENT_PROOF_BYTES,
  MAX_REQUEST_BYTES,
  MAX_UPLOAD_REQUEST_BYTES,
  N8N_WEBHOOK_URL,
  NODE_ENV,
  PORT,
  TURNSTILE_ENABLED,
  TURNSTILE_SECRET_KEY,
  TURNSTILE_SITE_KEY,
} from "./config";
import { db, closeDatabase } from "./db";
import { calonSantriWaitinglist } from "./db/schema";
import {
  allowedRate,
  clientIp,
  createSession,
  credentialsMatch,
  csrfMatches,
  originIsSame,
  readSessionCookie,
  sessionCookie,
  validateSession,
  type AdminSession,
} from "./lib/auth";
import { getRegions } from "./lib/regions";
import {
  decryptField,
  decryptPaymentProof,
  decryptSensitiveRecord,
  encryptPaymentProof,
  encryptSensitiveRecord,
  type DecryptedRow,
} from "./lib/encryption";
import { detectPaymentProofMime } from "./lib/payment-proof";
import { getSettingUpdatedAt, getSystemSettings, saveSystemSettings, seedSystemSettings } from "./lib/settings";
import { encryptLegacyWaitinglistRows } from "./lib/security-migration";
import {
  csvSafe,
  eligibleBirthdate,
  validateSettings,
  validateWaitinglist,
  type SystemSettings,
  type WaitinglistRecordInput,
} from "./lib/validation";

const PUBLIC_DIR = resolve(import.meta.dir, "../public");
const PAYMENT_PROOF_DIR = resolve(DATA_DIR, "payment-proofs");
const SESSION_HOURS = 4;
type WaitinglistView = DecryptedRow<typeof calonSantriWaitinglist.$inferSelect>;
type StoredWaitinglistRow = typeof calonSantriWaitinglist.$inferSelect;
type WaitinglistFilterQuery = { q?: string; status?: string; kecamatan?: string };

const waitinglistBody = t.Object({
  nama_ortu: t.String({ minLength: 1, maxLength: 120 }),
  status_ortu: t.Union([t.Literal("bapak"), t.Literal("ibu")]),
  nama_anak: t.String({ minLength: 1, maxLength: 120 }),
  jenis_kelamin: t.Union([t.Literal("putra"), t.Literal("putri")]),
  sekolah_asal: t.Optional(t.String({ maxLength: 120 })),
  tanggal_lahir_anak: t.String({ minLength: 10, maxLength: 10 }),
  provinsi_id: t.String({ minLength: 1, maxLength: 20 }),
  provinsi_nama: t.String({ minLength: 1, maxLength: 120 }),
  kabupaten_id: t.String({ minLength: 1, maxLength: 20 }),
  kabupaten_nama: t.String({ minLength: 1, maxLength: 120 }),
  kecamatan_id: t.String({ minLength: 1, maxLength: 20 }),
  kecamatan_nama: t.String({ minLength: 1, maxLength: 120 }),
  desa_id: t.String({ minLength: 1, maxLength: 20 }),
  desa_nama: t.String({ minLength: 1, maxLength: 120 }),
  no_hp_wa: t.String({ minLength: 1, maxLength: 64 }),
  email: t.String({ minLength: 3, maxLength: 254 }),
  konfirmasi_data: t.Union([t.Boolean(), t.Literal("true")]),
  konfirmasi_bukti_transfer: t.Union([t.Boolean(), t.Literal("true")]),
  konfirmasi_ketentuan_biaya: t.Union([t.Boolean(), t.Literal("true")]),
  bukti_transfer: t.File({ maxSize: MAX_PAYMENT_PROOF_BYTES }),
  website: t.Optional(t.String({ maxLength: 255 })),
  turnstile_token: t.Optional(t.String({ maxLength: 4096 })),
});

const adminSettingsBody = t.Object({
  cutoffDate: t.String({ minLength: 10, maxLength: 10 }),
  minAgeYears: t.Integer({ minimum: 0, maximum: 18 }),
  minAgeMonths: t.Integer({ minimum: 0, maximum: 11 }),
  whatsappGroupUrl: t.String({ maxLength: 500 }),
});

function getAdminSession(request: Request): AdminSession | null {
  return validateSession(readSessionCookie(request.headers.get("cookie")));
}

function requireAdmin(request: Request, set: { status?: number | string }): AdminSession | null {
  const session = getAdminSession(request);
  if (!session) set.status = 401;
  return session;
}

function requireCsrf(request: Request, session: AdminSession, set: { status?: number | string }): boolean {
  if (csrfMatches(session, request.headers.get("x-csrf-token"))) return true;
  set.status = 403;
  return false;
}

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  if (!TURNSTILE_ENABLED) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp });
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return Boolean(result.success);
  } catch {
    return false;
  }
}

async function triggerN8n(recordId: string, values: WaitinglistRecordInput, groupUrl: string): Promise<string> {
  if (!N8N_WEBHOOK_URL) return "not_configured";
  const payload = {
    id: recordId,
    nama_ortu: values.nama_ortu,
    status_ortu: values.status_ortu,
    nama_anak: values.nama_anak,
    no_hp_wa: values.no_hp_wa,
    email: values.email,
    status_eligibility: values.status_eligibility,
    whatsapp_group_url: groupUrl,
  };
  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "SPSB/1.0" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? "sent" : "failed";
  } catch {
    console.error("n8n webhook delivery failed");
    return "failed";
  }
}

function matchesEncryptedWaitinglist(row: StoredWaitinglistRow, query: WaitinglistFilterQuery): boolean {
  const status = query.status ?? "all";
  if (status === "eligible" || status === "not_eligible") {
    const rowStatus = decryptField(row.status_eligibility, "status_eligibility", row.id);
    if (rowStatus !== status) return false;
  }

  const kecamatan = (query.kecamatan ?? "").trim().slice(0, 120);
  if (kecamatan) {
    const districtName = decryptField(row.kecamatan_nama, "kecamatan_nama", row.id);
    if (!districtName.toLocaleLowerCase().includes(kecamatan.toLocaleLowerCase())) return false;
  }

  const text = (query.q ?? "").trim().slice(0, 120).toLocaleLowerCase();
  if (text) {
    const searchableFields = [
      ["nama_anak", row.nama_anak],
      ["nama_ortu", row.nama_ortu],
      ["email", row.email],
      ["no_hp_wa", row.no_hp_wa],
      ["desa_nama", row.desa_nama],
    ] as const;
    const found = searchableFields.some(([field, value]) => (
      decryptField(value, field, row.id).toLocaleLowerCase().includes(text)
    ));
    if (!found) return false;
  }
  return true;
}

export const app = new Elysia({ name: "spsb-waitinglist" })
  .onRequest(({ request, set }) => {
    const isProofUpload = request.method === "POST"
      && new URL(request.url).pathname === "/api/waitinglist"
      && request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data");
    const maxBytes = isProofUpload ? MAX_UPLOAD_REQUEST_BYTES : MAX_REQUEST_BYTES;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maxBytes) {
      set.status = 413;
      return { error: "Ukuran data terlalu besar." };
    }
  })
  .onAfterHandle(({ request, set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["X-Frame-Options"] = "DENY";
    set.headers["Referrer-Policy"] = NODE_ENV === "production" ? "no-referrer" : "strict-origin-when-cross-origin";
    set.headers["X-DNS-Prefetch-Control"] = "off";
    set.headers["X-Permitted-Cross-Domain-Policies"] = "none";
    set.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    set.headers["Content-Security-Policy"] = [
      "default-src 'self'",
      "script-src 'self' https://challenges.cloudflare.com",
      "style-src 'self'",
      "img-src 'self' data: https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "connect-src 'self' https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    if (NODE_ENV === "production" && COOKIE_SECURE) {
      set.headers["Strict-Transport-Security"] = "max-age=31536000";
    }
    if (new URL(request.url).pathname.startsWith("/api/")) {
      set.headers["Cache-Control"] = "no-store";
    }
  })
  .onError(({ code, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "Halaman tidak ditemukan." };
    }
    if (code === "VALIDATION") {
      set.status = 400;
      return { error: "Format data tidak valid." };
    }
    console.error("Unhandled request error code:", code);
    set.status = 500;
    return { error: "Terjadi kesalahan. Silakan coba kembali." };
  })
  .get("/", () => Bun.file(join(PUBLIC_DIR, "index.html")))
  .get("/admin", () => Bun.file(join(PUBLIC_DIR, "admin.html")))
  .get("/success", () => Bun.file(join(PUBLIC_DIR, "success.html")))
  .get("/app.css", () => Bun.file(join(PUBLIC_DIR, "app.css")))
  .get("/app.js", () => Bun.file(join(PUBLIC_DIR, "app.js")))
  .get("/admin.js", () => Bun.file(join(PUBLIC_DIR, "admin.js")))
  .get("/success.js", () => Bun.file(join(PUBLIC_DIR, "success.js")))
  .get("/favicon.svg", () => Bun.file(join(PUBLIC_DIR, "favicon.svg")))
  .get("/logo-gq.png", () => Bun.file(join(PUBLIC_DIR, "logo-gq.png")))
  .get("/healthz", () => ({ status: "ok" }))
  .get("/readyz", async ({ set }) => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ready", database: "connected" };
    } catch {
      set.status = 503;
      return { status: "not_ready", database: "disconnected" };
    }
  })
  .get("/api/config", async () => {
    const settings = await getSystemSettings();
    return {
      cutoffDate: settings.cutoffDate,
      eligibleBirthdate: eligibleBirthdate(settings),
      minAgeYears: settings.minAgeYears,
      minAgeMonths: settings.minAgeMonths,
      whatsappGroupUrl: settings.whatsappGroupUrl,
      turnstileSiteKey: TURNSTILE_ENABLED ? TURNSTILE_SITE_KEY : "",
    };
  })
  .get("/api/regions/:level", async ({ params, query, set }) => {
    try {
      return { items: await getRegions(params.level, query.parent_id ?? "") };
    } catch (error) {
      set.status = error instanceof Error && error.message.startsWith("Data wilayah") ? 503 : 400;
      return { error: error instanceof Error ? error.message : "Data wilayah tidak tersedia." };
    }
  }, {
    params: t.Object({ level: t.String({ maxLength: 24 }) }),
    query: t.Object({ parent_id: t.Optional(t.String({ maxLength: 20 })) }),
  })
  .post("/api/waitinglist", async ({ body, request, set }) => {
    if (!originIsSame(request)) {
      set.status = 403;
      return { error: "Permintaan lintas situs ditolak." };
    }
    const ip = clientIp(request);
    if (!allowedRate(`submit:${ip}`, 8, 10 * 60)) {
      set.status = 429;
      return { error: "Terlalu banyak percobaan. Silakan coba lagi beberapa menit." };
    }
    if (String(body.website ?? "").trim()) {
      set.status = 201;
      return { id: randomBytes(8).toString("hex"), emailStatus: "skipped" };
    }
    if (!await verifyTurnstile(String(body.turnstile_token ?? ""), ip)) {
      set.status = 400;
      return { error: "Verifikasi anti-spam gagal. Silakan coba lagi." };
    }

    const settings = await getSystemSettings();
    let values: WaitinglistRecordInput;
    try {
      values = validateWaitinglist(body, settings);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : "Data pendaftaran tidak valid." };
    }

    const proofBytes = Buffer.from(await body.bukti_transfer.arrayBuffer());
    const proofMime = detectPaymentProofMime(proofBytes);
    if (!proofMime) {
      set.status = 400;
      return { error: "Bukti transfer harus berupa file JPG, PNG, atau PDF yang valid." };
    }
    if (!proofBytes.length || proofBytes.length > MAX_PAYMENT_PROOF_BYTES) {
      set.status = 400;
      return { error: "Ukuran bukti transfer maksimal 5 MB." };
    }

    const id = randomBytes(16).toString("hex");
    const proofPath = join(PAYMENT_PROOF_DIR, `${id}.enc`);
    let proofWritten = false;
    try {
      await mkdir(PAYMENT_PROOF_DIR, { recursive: true, mode: 0o700 });
      await chmod(PAYMENT_PROOF_DIR, 0o700);
      await writeFile(proofPath, encryptPaymentProof(proofBytes, id), { flag: "wx", mode: 0o600 });
      proofWritten = true;
      const encryptedValues = encryptSensitiveRecord({
        id,
        ...values,
        bukti_transfer_mime: proofMime,
        umur_terhitung_bulan: String(values.umur_terhitung_bulan),
      });
      await db.insert(calonSantriWaitinglist).values(encryptedValues);
    } catch {
      if (proofWritten) await unlink(proofPath).catch(() => undefined);
      console.error("Failed to persist encrypted waitinglist submission");
      set.status = 500;
      return { error: "Data belum dapat disimpan. Silakan coba kembali." };
    }
    const emailStatus = await triggerN8n(id, values, settings.whatsappGroupUrl);
    set.status = 201;
    return { id, emailStatus, whatsappGroupUrl: settings.whatsappGroupUrl };
  }, { body: waitinglistBody })
  .get("/api/admin/me", ({ request }) => {
    const session = getAdminSession(request);
    return { authenticated: Boolean(session), username: session?.username ?? null, csrfToken: session?.csrfToken ?? null };
  })
  .post("/api/admin/login", async ({ body, request, set }) => {
    if (!originIsSame(request)) {
      set.status = 403;
      return { error: "Permintaan lintas situs ditolak." };
    }
    const ip = clientIp(request);
    if (!allowedRate(`login:${ip}`, 8, 15 * 60)) {
      set.status = 429;
      return { error: "Terlalu banyak percobaan login. Silakan coba lagi nanti." };
    }
    if (!credentialsMatch(body.username, body.password)) {
      set.status = 401;
      return { error: "Username atau password salah." };
    }
    const session = createSession(body.username);
    set.headers["Set-Cookie"] = sessionCookie(session.token, SESSION_HOURS * 60 * 60);
    return { authenticated: true, username: body.username, csrfToken: session.csrfToken };
  }, {
    body: t.Object({ username: t.String({ maxLength: 120 }), password: t.String({ maxLength: 256 }) }),
  })
  .post("/api/admin/logout", ({ request, set }) => {
    if (!originIsSame(request)) {
      set.status = 403;
      return { error: "Permintaan lintas situs ditolak." };
    }
    const session = requireAdmin(request, set);
    if (!session) return { error: "Silakan login sebagai admin." };
    if (!requireCsrf(request, session, set)) return { error: "Sesi keamanan tidak valid." };
    set.headers["Set-Cookie"] = sessionCookie("", 0);
    return { authenticated: false };
  })
  .get("/api/admin/system", async ({ request, set }) => {
    if (!requireAdmin(request, set)) return { error: "Silakan login sebagai admin." };
    const base = {
      app: { status: "online", runtime: `Bun ${Bun.version}`, uptimeSeconds: Math.floor(process.uptime()) },
      database: { status: "offline" as "offline" | "online" },
      metrics: { total: 0, eligible: 0, last24Hours: 0 },
      integrations: { n8nConfigured: Boolean(N8N_WEBHOOK_URL), turnstileEnabled: TURNSTILE_ENABLED },
      settings: null as SystemSettings | null,
      settingsUpdatedAt: null as string | null,
    };
    try {
      const settings = await getSystemSettings();
      const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [totalRows, recentRows, eligibilityRows] = await Promise.all([
        db.select({ total: count() }).from(calonSantriWaitinglist),
        db.select({ total: count() }).from(calonSantriWaitinglist)
          .where(gt(calonSantriWaitinglist.created_at, cutoffTime)),
        db.select({ id: calonSantriWaitinglist.id, status: calonSantriWaitinglist.status_eligibility })
          .from(calonSantriWaitinglist),
      ]);
      base.database.status = "online";
      base.metrics = {
        total: totalRows[0]?.total ?? 0,
        eligible: eligibilityRows.reduce((total, row) => (
          total + (decryptField(row.status, "status_eligibility", row.id) === "eligible" ? 1 : 0)
        ), 0),
        last24Hours: recentRows[0]?.total ?? 0,
      };
      base.settings = settings;
      base.settingsUpdatedAt = await getSettingUpdatedAt();
    } catch {
      console.error("Admin system dashboard could not read database status");
    }
    return base;
  })
  .get("/api/admin/settings", async ({ request, set }) => {
    if (!requireAdmin(request, set)) return { error: "Silakan login sebagai admin." };
    return {
      settings: await getSystemSettings(),
      updatedAt: await getSettingUpdatedAt(),
    };
  })
  .put("/api/admin/settings", async ({ body, request, set }) => {
    if (!originIsSame(request)) {
      set.status = 403;
      return { error: "Permintaan lintas situs ditolak." };
    }
    const session = requireAdmin(request, set);
    if (!session) return { error: "Silakan login sebagai admin." };
    if (!requireCsrf(request, session, set)) return { error: "Sesi keamanan tidak valid." };
    let settings: SystemSettings;
    try {
      settings = validateSettings(body);
    } catch (error) {
      set.status = 400;
      return { error: error instanceof Error ? error.message : "Pengaturan tidak valid." };
    }
    try {
      await saveSystemSettings(settings);
      return { saved: true, settings, eligibleBirthdate: eligibleBirthdate(settings) };
    } catch {
      console.error("Failed to save system settings");
      set.status = 500;
      return { error: "Pengaturan belum dapat disimpan. Silakan coba kembali." };
    }
  }, { body: adminSettingsBody })
  .get("/api/admin/waitinglist/:id/proof", async ({ params, request, set }) => {
    if (!requireAdmin(request, set)) return { error: "Silakan login sebagai admin." };
    const [row] = await db.select({ mime: calonSantriWaitinglist.bukti_transfer_mime })
      .from(calonSantriWaitinglist)
      .where(eq(calonSantriWaitinglist.id, params.id))
      .limit(1);
    const mime = row?.mime;
    if (!mime || !["image/jpeg", "image/png", "application/pdf"].includes(mime)) {
      set.status = 404;
      return { error: "Bukti transfer tidak ditemukan." };
    }
    const extension = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "pdf";
    try {
      const encrypted = await readFile(join(PAYMENT_PROOF_DIR, `${params.id}.enc`));
      const proof = decryptPaymentProof(encrypted, params.id);
      const responseBody = new Uint8Array(proof.byteLength);
      responseBody.set(proof);
      return new Response(responseBody, {
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `attachment; filename="bukti-transfer.${extension}"`,
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      set.status = 404;
      return { error: "Bukti transfer tidak ditemukan atau tidak dapat dibuka." };
    }
  }, { params: t.Object({ id: t.String({ pattern: "^[a-f0-9]{32}$" }) }) })
  .get("/api/admin/waitinglist", async ({ query, request, set }) => {
    if (!requireAdmin(request, set)) return { error: "Silakan login sebagai admin." };
    const pageSize = 25;
    const parsedPage = Number.parseInt(query.page ?? "1", 10);
    const page = Number.isFinite(parsedPage) ? Math.max(1, Math.min(parsedPage, 1_000_000)) : 1;
    const filtersActive = Boolean(query.q?.trim() || query.kecamatan?.trim()
      || (query.status && query.status !== "all"));
    if (!filtersActive) {
      const [totalRows, storedRows] = await Promise.all([
        db.select({ total: count() }).from(calonSantriWaitinglist),
        db.select().from(calonSantriWaitinglist)
          .orderBy(desc(calonSantriWaitinglist.created_at))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
      ]);
      const total = totalRows[0]?.total ?? 0;
      return {
        rows: storedRows.map((row) => decryptSensitiveRecord(row)),
        total,
        page,
        pageSize,
        pages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }
    const storedRows = await db.select().from(calonSantriWaitinglist)
      .orderBy(desc(calonSantriWaitinglist.created_at));
    const filteredRows = storedRows.filter((row) => matchesEncryptedWaitinglist(row, query));
    const total = filteredRows.length;
    const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
      .map((row) => decryptSensitiveRecord(row));
    return { rows, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
  }, {
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 120 })),
      status: t.Optional(t.Union([t.Literal("all"), t.Literal("eligible"), t.Literal("not_eligible")])),
      kecamatan: t.Optional(t.String({ maxLength: 120 })),
      page: t.Optional(t.String({ maxLength: 12 })),
    }),
  })
  .get("/api/admin/export.csv", async ({ query, request, set }) => {
    if (!requireAdmin(request, set)) return { error: "Silakan login sebagai admin." };
    const storedRows = await db.select().from(calonSantriWaitinglist)
      .orderBy(desc(calonSantriWaitinglist.created_at));
    const rows = storedRows
      .filter((row) => matchesEncryptedWaitinglist(row, query))
      .map((row) => decryptSensitiveRecord(row));
    const output: string[][] = [[
      "ID", "Nama Anak", "Jenis Kelamin", "Sekolah Asal", "Tanggal Lahir", "Umur Tercatat Saat Daftar (bulan)",
      "Status Kelayakan", "Persetujuan Ketentuan Biaya", "Nama Orang Tua", "Status Orang Tua", "Provinsi", "Kabupaten/Kota",
      "Kecamatan", "Desa/Kelurahan", "WhatsApp", "Email", "Tanggal Submit",
    ]];
    for (const row of rows) {
      output.push([
        csvSafe(row.id), csvSafe(row.nama_anak),
        csvSafe(row.jenis_kelamin === "putra" ? "Putra" : row.jenis_kelamin === "putri" ? "Putri" : "Belum dicatat"),
        csvSafe(row.sekolah_asal || ""), csvSafe(row.tanggal_lahir_anak), String(row.umur_terhitung_bulan), csvSafe(row.status_eligibility),
        csvSafe(row.konfirmasi_ketentuan_biaya === 1 ? "Setuju" : "Belum dicatat"), csvSafe(row.nama_ortu),
        csvSafe(row.status_ortu), csvSafe(row.provinsi_nama), csvSafe(row.kabupaten_nama),
        csvSafe(row.kecamatan_nama), csvSafe(row.desa_nama), csvSafe(row.no_hp_wa),
        csvSafe(row.email), csvSafe(row.created_at),
      ]);
    }
    const csv = `\uFEFF${output.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    set.headers["Content-Type"] = "text/csv; charset=utf-8";
    set.headers["Content-Disposition"] = 'attachment; filename="waitinglist-spsb-2027.csv"';
    set.headers["Cache-Control"] = "no-store";
    return csv;
  }, {
    query: t.Object({
      q: t.Optional(t.String({ maxLength: 120 })),
      status: t.Optional(t.Union([t.Literal("all"), t.Literal("eligible"), t.Literal("not_eligible")])),
      kecamatan: t.Optional(t.String({ maxLength: 120 })),
      page: t.Optional(t.String({ maxLength: 12 })),
    }),
  });

async function main(): Promise<void> {
  assertProductionSecurityConfig();
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(PAYMENT_PROOF_DIR, { recursive: true, mode: 0o700 });
  await chmod(PAYMENT_PROOF_DIR, 0o700);
  await migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
  await encryptLegacyWaitinglistRows();
  await seedSystemSettings();
  app.listen({ hostname: HOST, port: PORT, maxRequestBodySize: MAX_UPLOAD_REQUEST_BYTES });
  console.info(`SPSB application listening on http://${app.server?.hostname ?? HOST}:${app.server?.port ?? PORT}`);
  console.info(`Environment: ${NODE_ENV}`);
  if (!ADMIN_PASSWORD_CONFIGURED) {
    console.warn("Admin login uses a temporary password that is not printed; set ADMIN_PASSWORD to make the login usable.");
  }
  if (!APP_SECRET_CONFIGURED) {
    console.warn("WARNING: APP_SECRET is temporary; set a persistent secret before deployment.");
  }
  process.on("SIGTERM", async () => {
    await app.stop();
    await closeDatabase();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    await app.stop();
    await closeDatabase();
    process.exit(0);
  });
}

if (import.meta.main) await main();
