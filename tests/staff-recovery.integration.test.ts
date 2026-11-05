import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createConnection, type RowDataPacket } from "mysql2/promise";

const databaseUrl = process.env.STAFF_RECOVERY_TEST_DATABASE_URL;

test.skipIf(!databaseUrl)("host recovery is explicit, transactional, and restricted to the selected Admin", async () => {
  const url = new URL(databaseUrl!);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !/^\/spsb_auth_test_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("Use an empty local spsb_auth_test_* database for staff recovery tests.");
  }
  const inspector = await createConnection(databaseUrl!);
  try {
    const [tables] = await inspector.query<RowDataPacket[]>("SHOW TABLES");
    if (tables.length) throw new Error("Staff recovery tests require an empty dedicated database.");
  } finally { await inspector.end(); }

  const envUsername = "envlead";
  const envPassword = "Host8pw!";
  Object.assign(process.env, { DATABASE_URL: databaseUrl, NODE_ENV: "test", ADMIN_USERNAME: envUsername,
    ADMIN_PASSWORD: envPassword, APP_SECRET: "staff-recovery-test-session-secret-32-chars",
    DATA_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", COOKIE_SECURE: "false",
    N8N_WEBHOOK_URL: "", N8N_PAYMENT_WEBHOOK_URL: "", TURNSTILE_SITE_KEY: "", TURNSTILE_SECRET_KEY: "", DB_SSL: "false" });
  const [{ db, closeDatabase }, schema, auth, { recoverAdminFromHost }, { migrate }, { eq }, { decryptField }] = await Promise.all([
    import("../src/db"), import("../src/db/schema"), import("../src/lib/staff-auth"), import("../src/lib/staff-recovery"),
    import("drizzle-orm/mysql2/migrator"), import("drizzle-orm"), import("../src/lib/encryption"),
  ]);
  const { staffUsers, staffSessions, auditEvents } = schema;
  const { sessionCookie } = await import("../src/lib/auth");
  const staffSession = async (token: string) => {
    const session = await auth.getStaffSession(new Request("http://localhost/api/admin/me", { headers: { cookie: sessionCookie(token) } }));
    expect(session).not.toBeNull();
    return session!;
  };
  const userByName = async (username: string) => (await db.select().from(staffUsers).where(eq(staffUsers.username, username)))[0]!;
  const allUsers = () => db.select().from(staffUsers).orderBy(staffUsers.id);
  const sessions = () => db.select().from(staffSessions).orderBy(staffSessions.token_hash);
  const expectStatus = async (operation: () => Promise<unknown>, status: number) => {
    let caught: unknown;
    try { await operation(); } catch (error) { caught = error; }
    expect((caught as { status?: number } | undefined)?.status).toBe(status);
  };
  try {
    await migrate(db, { migrationsFolder: resolve(import.meta.dir, "../drizzle") });
    await auth.seedStaffAdmin();
    expect(auth.configuredAdminUsername(" EnvLead ")).toBe(envUsername);
    const seeded = await userByName(envUsername);
    expect(seeded.role).toBe("admin");
    const initialLogin = await auth.authenticateStaff(envUsername, envPassword);
    expect(initialLogin?.user.id).toBe(seeded.id);
    await expectStatus(() => auth.createStaff({ name: "Short staff", username: "shorter", role: "bendahara", password: envPassword }, envUsername), 400);
    await auth.createStaff({ name: "Other Admin", username: "other-admin", role: "admin", password: "other-admin-test-pass" }, envUsername);
    await auth.createStaff({ name: "Bendahara", username: "finance-staff", role: "bendahara", password: "treasurer-test-pass" }, envUsername);
    await auth.authenticateStaff("other-admin", "other-admin-test-pass");
    await auth.authenticateStaff("finance-staff", "treasurer-test-pass");
    await auth.changeStaffPassword(await staffSession(initialLogin!.token), envPassword, "changed-stored-pass");
    await db.update(staffUsers).set({ username: "original-admin" }).where(eq(staffUsers.id, seeded.id));

    const unchangedUsers = await allUsers();
    const unchangedSessions = await sessions();
    await auth.seedStaffAdmin();
    expect(await auth.authenticateStaff(envUsername, envPassword)).toBeNull();
    expect(await allUsers()).toEqual(unchangedUsers);
    await expectStatus(() => recoverAdminFromHost({ username: envUsername, password: envPassword }), 404);
    await expectStatus(() => recoverAdminFromHost({ username: "finance-staff", password: envPassword }), 403);
    await expectStatus(() => recoverAdminFromHost({ username: "finance-staff", password: envPassword, create: true }), 409);
    await expectStatus(() => recoverAdminFromHost({ username: "other-admin", password: envPassword, create: true }), 409);
    expect(await allUsers()).toEqual(unchangedUsers);
    expect(await sessions()).toEqual(unchangedSessions);

    const created = await recoverAdminFromHost({ username: envUsername, password: envPassword, create: true });
    expect(created.created).toBe(true);
    const recoveryUser = await userByName(envUsername);
    expect(recoveryUser).toMatchObject({ role: "admin", active: 1, must_change_password: 1 });
    expect(await Bun.password.verify(envPassword, recoveryUser.password_hash)).toBe(true);
    expect((await allUsers()).filter(user => user.id !== created.id)).toEqual(unchangedUsers);
    expect(await sessions()).toEqual(unchangedSessions);

    const login = await auth.authenticateStaff(envUsername, envPassword);
    await auth.changeStaffPassword(await staffSession(login!.token), envPassword, "New8pwd!");
    await auth.authenticateStaff(envUsername, "New8pwd!");
    await auth.authenticateStaff(envUsername, "New8pwd!");
    const beforeReset = await userByName(envUsername);
    await recoverAdminFromHost({ username: envUsername, password: envPassword });
    const afterReset = await userByName(envUsername);
    expect(afterReset).toMatchObject({ id: beforeReset.id, role: "admin", active: 1, must_change_password: 1, version: beforeReset.version + 1 });
    expect(await sessions()).toEqual(unchangedSessions);
    expect(await auth.authenticateStaff(envUsername, "New8pwd!")).toBeNull();
    expect((await auth.authenticateStaff(envUsername, envPassword))?.user.mustChangePassword).toBe(true);
    await db.update(staffUsers).set({ active: 0 }).where(eq(staffUsers.id, created.id));
    await recoverAdminFromHost({ username: envUsername, password: envPassword });
    expect((await userByName(envUsername)).active).toBe(1);
    expect(await sessions()).toEqual(unchangedSessions);

    const beforeFailure = await userByName(envUsername);
    await auth.authenticateStaff(envUsername, envPassword);
    const sessionsBeforeFailure = await sessions();
    await db.execute("RENAME TABLE audit_events TO staff_recovery_audit_backup");
    let auditFailure: unknown;
    try {
      try { await recoverAdminFromHost({ username: envUsername, password: "rollback-test-password" }); }
      catch (error) { auditFailure = error; }
    } finally { await db.execute("RENAME TABLE staff_recovery_audit_backup TO audit_events"); }
    expect(auditFailure instanceof Error).toBe(true);
    expect(await userByName(envUsername)).toEqual(beforeFailure);
    expect(await sessions()).toEqual(sessionsBeforeFailure);

    const concurrent = await Promise.allSettled([
      recoverAdminFromHost({ username: "race-admin", password: envPassword, create: true }),
      recoverAdminFromHost({ username: "race-admin", password: envPassword, create: true }),
    ]);
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = concurrent.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    expect((await allUsers()).filter(user => user.username === "race-admin")).toHaveLength(1);

    const command = async (username: string, flags: string[]) => {
      const child = Bun.spawn([process.execPath, "run", "staff:recover", ...flags], {
        cwd: resolve(import.meta.dir, ".."), env: { ...process.env, ADMIN_USERNAME: username, ADMIN_PASSWORD: envPassword },
        stdout: "pipe", stderr: "pipe",
      });
      const [output, errors, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(output + errors).not.toContain(envPassword);
      return { output, errors, exitCode };
    };
    expect((await command("clilead", ["--", "--create"])).exitCode).toBe(0);
    expect((await command("clilead", [])).exitCode).toBe(0);
    expect((await command("finance-staff", [])).exitCode).toBe(1);
    expect((await command("", [])).exitCode).toBe(1);
    expect((await command("other-admin", ["--invalid"])).exitCode).toBe(1);
    expect((await userByName("clilead")).role).toBe("admin");
    expect((await userByName("finance-staff")).role).toBe("bendahara");
    expect((await userByName("other-admin"))).toEqual(unchangedUsers.find(user => user.username === "other-admin")!);
    expect((await userByName("original-admin"))).toEqual(unchangedUsers.find(user => user.username === "original-admin")!);
    for (const event of await db.select().from(auditEvents)) {
      if (!["admin_recovered", "admin_recovery_created"].includes(event.action)) continue;
      const payload = JSON.parse(decryptField(event.payload, "audit", event.id));
      expect(Object.keys(payload)).toEqual(["username"]);
    }
  } finally { await closeDatabase(); }
}, 120_000);
