import { describe, expect, test } from "bun:test";

describe("Elysia application", () => {
  test("serves health status with security headers", async () => {
    process.env.ADMIN_USERNAME = "test-admin";
    process.env.ADMIN_PASSWORD = "test-admin-password";
    process.env.APP_SECRET = "test-secret-with-more-than-32-characters";
    process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const { app } = await import("../src/index");
    const response = await app.handle(new Request("http://localhost/healthz"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("serves every static page and frontend asset", async () => {
    const { app } = await import("../src/index");
    const assets = ["/", "/admin", "/success", "/app.css", "/app.js", "/admin.js", "/success.js", "/favicon.svg", "/logo-gq.png"];
    const responses = await Promise.all(assets.map((path) => app.handle(new Request(`http://localhost${path}`))));

    const bodies = await Promise.all(responses.map((response) => response.text()));
    for (const [index, response] of responses.entries()) {
      expect(response.status).toBe(200);
      expect(bodies[index]!.length).toBeGreaterThan(0);
    }
    expect(bodies[1]).toContain("Pengaturan sistem");
  });

  test("rejects unknown routes, oversized requests, and invalid region queries safely", async () => {
    const { app } = await import("../src/index");
    expect((await app.handle(new Request("http://localhost/not-found"))).status).toBe(404);

    const largeBody = JSON.stringify({ value: "x".repeat(33_000) });
    const oversized = await app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(largeBody.length) },
      body: largeBody,
    }));
    expect(oversized.status).toBe(413);

    const invalidLevel = await app.handle(new Request("http://localhost/api/regions/unknown"));
    expect(invalidLevel.status).toBe(400);
    const invalidParent = await app.handle(new Request("http://localhost/api/regions/villages?parent_id=32.73"));
    expect(invalidParent.status).toBe(400);
  });

  test("parses valid multipart registration data before enforcing same-origin submission", async () => {
    const { app } = await import("../src/index");
    const form = new FormData();
    const fields = {
      nama_ortu: "Aminah",
      status_ortu: "ibu",
      nama_anak: "Ahmad",
      jenis_kelamin: "putra",
      tanggal_lahir_anak: "2021-01-01",
      provinsi_id: "32",
      provinsi_nama: "Jawa Barat",
      kabupaten_id: "32.73",
      kabupaten_nama: "Kota Bandung",
      kecamatan_id: "32.73.01",
      kecamatan_nama: "Sukasari",
      desa_id: "32.73.01.1001",
      desa_nama: "Sukarasa",
      no_hp_wa: "081234567890",
      email: "aminah@example.com",
      konfirmasi_data: "true",
      konfirmasi_bukti_transfer: "true",
      konfirmasi_ketentuan_biaya: "true",
    };
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append("bukti_transfer", new Blob(["%PDF-1.7\\nproof"], { type: "application/pdf" }), "proof.pdf");
    const response = await app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: { host: "localhost", origin: "https://attacker.example" },
      body: form,
    }));
    expect(response.status).toBe(403);
  });

  test("rejects payment proof uploads larger than 5 MB", async () => {
    const { app } = await import("../src/index");
    const form = new FormData();
    form.append("bukti_transfer", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "application/pdf" }), "large.pdf");
    const response = await app.handle(new Request("http://localhost/api/waitinglist", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost" },
      body: form,
    }));
    expect(response.status).toBe(400);
  });

  test("rejects cross-origin and incorrect admin credentials", async () => {
    const { app } = await import("../src/index");
    const crossOrigin = await app.handle(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { host: "localhost", origin: "https://attacker.example", "content-type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "test-admin-password" }),
    }));
    expect(crossOrigin.status).toBe(403);

    const incorrectCredentials = await app.handle(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "wrong-password" }),
    }));
    expect(incorrectCredentials.status).toBe(401);
  });

  test("protects all participant export endpoints without an admin session", async () => {
    const { app } = await import("../src/index");
    const id = "0123456789abcdef0123456789abcdef";
    const paths = [
      "/api/admin/export.csv",
      "/api/admin/export.xlsx",
      `/api/admin/waitinglist/${id}/export.pdf`,
      `/api/admin/waitinglist/${id}/export.xlsx`,
    ];
    for (const path of paths) {
      const response = await app.handle(new Request(`http://localhost${path}`));
      expect(response.status).toBe(401);
    }
  });

  test("rejects reversed export date ranges before reading the database", async () => {
    const { app } = await import("../src/index");
    const login = await app.handle(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "test-admin-password" }),
    }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const response = await app.handle(new Request(
      "http://localhost/api/admin/export.xlsx?tanggal_daftar_mulai=2027-02-03&tanggal_daftar_sampai=2027-02-02",
      { headers: { cookie } },
    ));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("harus berurutan") });
  });

  test("admin login issues a signed HttpOnly session and logout requires CSRF", async () => {
    const { app } = await import("../src/index");
    const login = await app.handle(new Request("http://localhost/api/admin/login", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ username: "test-admin", password: "test-admin-password" }),
    }));
    const loginResult = await login.json() as { csrfToken: string };
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

    expect(login.status).toBe(200);
    expect(cookie).toContain("psb_admin_session=");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");

    const me = await app.handle(new Request("http://localhost/api/admin/me", { headers: { cookie } }));
    expect(await me.json()).toMatchObject({ authenticated: true, username: "test-admin" });

    const logoutWithoutCsrf = await app.handle(new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", cookie, "content-type": "application/json" },
      body: "{}",
    }));
    expect(logoutWithoutCsrf.status).toBe(403);

    const logout = await app.handle(new Request("http://localhost/api/admin/logout", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        cookie,
        "x-csrf-token": loginResult.csrfToken,
        "content-type": "application/json",
      },
      body: "{}",
    }));
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
