import { Elysia, t } from "elysia";
import { getStaffSession, createStaff, listStaff, updateStaff, resetStaffPassword, changeStaffPassword } from "./staff-auth";
import { csrfMatches, originIsSame } from "./auth";
import { ensure, ServiceError } from "./admin-common";
import { createParticipant, updateParticipant, verifyPayment, participantHistory } from "./participants";
import { getSystemSettings } from "./settings";
import { validateWaitinglist } from "./validation";
import { MAX_PAYMENT_PROOF_BYTES } from "../config";

export async function authorizeStaffRequest(request: Request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  if (!path.startsWith("/api/admin/") || ["/api/admin/login", "/api/admin/me"].includes(path)) return;
  const session = await getStaffSession(request);
  ensure(session, 401, "Silakan login sebagai petugas.");
  if (session.user.mustChangePassword && !["/api/admin/password", "/api/admin/logout"].includes(path)) {
    throw new ServiceError(403, "Ganti password sebelum membuka dashboard.", "PASSWORD_CHANGE_REQUIRED");
  }
  const write = !["GET", "HEAD"].includes(request.method);
  if (write) {
    ensure(originIsSame(request), 403, "Permintaan lintas situs ditolak.");
    ensure(csrfMatches(session, request.headers.get("x-csrf-token")), 403, "Token keamanan tidak valid. Muat ulang halaman.");
  }
  const adminOnly = /^\/api\/admin\/(users(?:\/|$)|settings(?:\/|$)|system$|brochure(?:\/|$))/.test(path)
    || (write && /^\/api\/admin\/waitinglist(?:\/[a-f0-9]{32}(?:\/(?:archive|restore))?)?$/.test(path));
  ensure(!adminOnly || session.user.role === "admin", 403, "Fitur ini hanya dapat digunakan Admin.");
}
const idParams = t.Object({ id: t.String({ pattern: "^[a-f0-9]{32}$" }) });
const role = t.Union([t.Literal("admin"), t.Literal("bendahara")]);
const staffBody = { name: t.String({ minLength: 1, maxLength: 120 }), role };
const text = (max = 120) => t.String({ minLength: 1, maxLength: max });
const participantBody = t.Object({
  nama_ortu: text(), status_ortu: t.Union([t.Literal("bapak"), t.Literal("ibu")]), nama_anak: text(),
  jenis_kelamin: t.Union([t.Literal("putra"), t.Literal("putri")]), sekolah_asal: t.Optional(t.String({ maxLength: 120 })),
  tanggal_lahir_anak: text(10), provinsi_id: text(20), provinsi_nama: text(), kabupaten_id: text(20), kabupaten_nama: text(),
  kecamatan_id: text(20), kecamatan_nama: text(), desa_id: text(20), desa_nama: text(), no_hp_wa: text(64), email: text(254),
  konfirmasi_data: t.Literal("true"), konfirmasi_bukti_transfer: t.Literal("true"), konfirmasi_ketentuan_biaya: t.Literal("true"),
  bukti_transfer: t.Optional(t.File({ maxSize: MAX_PAYMENT_PROOF_BYTES })),
  reason: t.Optional(t.String({ maxLength: 1000 })), version: t.Optional(t.String({ pattern: "^[1-9][0-9]*$" })),
});
export const adminManagementRoutes = new Elysia({ name: "staff-management" })
  .onRequest(async ({ request }) => { await authorizeStaffRequest(request); })
  .get("/api/admin/users", async () => ({ users: await listStaff() }))
  .post("/api/admin/users", async ({ body, request, set }) => {
    const result = await createStaff(body, (await getStaffSession(request))!.username); set.status = 201; return result;
  }, { body: t.Object({ ...staffBody, username: text(80), password: t.String({ minLength: 16, maxLength: 256 }), active: t.Optional(t.Boolean()) }) })
  .put("/api/admin/users/:id", async ({ body, params, request }) => {
    await updateStaff(params.id, body, (await getStaffSession(request))!.username); return { saved: true };
  }, { params: idParams, body: t.Object({ ...staffBody, active: t.Boolean(), version: t.Integer({ minimum: 1 }) }) })
  .post("/api/admin/users/:id/reset-password", async ({ body, params, request }) => {
    await resetStaffPassword(params.id, body.password, (await getStaffSession(request))!.username, body.version); return { saved: true };
  }, { params: idParams, body: t.Object({ password: t.String({ minLength: 16, maxLength: 256 }), version: t.Integer({ minimum: 1 }) }) })
  .post("/api/admin/password", async ({ body, request }) => {
    await changeStaffPassword((await getStaffSession(request))!, body.currentPassword, body.password); return { saved: true, loginRequired: true };
  }, { body: t.Object({ currentPassword: t.String({ maxLength: 256 }), password: t.String({ minLength: 16, maxLength: 256 }) }) })
  .post("/api/admin/waitinglist", async ({ body, request, set }) => {
    let values;
    try { values = validateWaitinglist(body, await getSystemSettings()); }
    catch (error) { throw new ServiceError(400, (error as Error).message); }
    ensure(body.bukti_transfer, 400, "Bukti transfer wajib diunggah.");
    const result = await createParticipant(values, body.bukti_transfer, (await getStaffSession(request))!.username);
    set.status = 201; return result;
  }, { body: participantBody })
  .put("/api/admin/waitinglist/:id", async ({ body, params, request }) => {
    return updateParticipant(params.id, body, body.bukti_transfer, (await getStaffSession(request))!.username);
  }, { params: idParams, body: participantBody })
  .put("/api/admin/waitinglist/:id/payment", async ({ body, params, request }) => verifyPayment(params.id, body, (await getStaffSession(request))!.username), {
    params: idParams, body: t.Object({ version: t.Integer({ minimum: 1 }),
      status: t.Union([t.Literal("pending"), t.Literal("verified"), t.Literal("needs_correction")]),
      date: t.Optional(t.String({ maxLength: 10 })), note: t.Optional(t.String({ maxLength: 1000 })), amountConfirmed: t.Optional(t.Boolean()) }),
  })
  .get("/api/admin/waitinglist/:id/history", ({ params }) => participantHistory(params.id), { params: idParams });
