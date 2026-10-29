import { mock } from "bun:test";
import { randomBytes, createHmac } from "node:crypto";

/** Isolate HTTP contract tests from storage. Real session/role flows use MariaDB integration tests. */
export async function mockStaffAuthentication() {
  const real = await import("../../src/lib/staff-auth");
  const { readSessionCookie } = await import("../../src/lib/auth");
  const { ADMIN_USERNAME, ADMIN_PASSWORD, APP_SECRET } = await import("../../src/config");
  const sessions = new Map<string, any>();
  mock.module("../../src/lib/staff-auth", () => ({ ...real,
    authenticateStaff: async (username: string, password: string) => {
      if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) return null;
      const token = randomBytes(32).toString("base64url");
      const csrfToken = createHmac("sha256", APP_SECRET).update(`csrf:${token}`).digest("hex");
      const user = { id: "f".repeat(32), name: "Test Admin", username, role: "admin", active: true, mustChangePassword: false, version: 1 };
      sessions.set(token, { tokenHash: token, csrfToken, username, user });
      return { token, csrfToken, user };
    },
    getStaffSession: async (request: Request) => sessions.get(readSessionCookie(request.headers.get("cookie")) || "") || null,
    revokeSession: async (session: any) => { sessions.delete(session.tokenHash); },
  }));
}
