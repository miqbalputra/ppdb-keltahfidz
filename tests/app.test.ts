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

  test("serves existing static frontend from the application root", async () => {
    const { app } = await import("../src/index");
    const response = await app.handle(new Request("http://localhost/admin"));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Pengaturan sistem");
    expect(html).toContain("Status sistem");
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
