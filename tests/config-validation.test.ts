import { describe, expect, test } from "bun:test";
import {
  assertTurnstilePair,
  parseDbPoolSize,
  productionSecurityProblems,
  type ProductionSecuritySettings,
} from "../src/lib/config-validation";

const secureProductionSettings: ProductionSecuritySettings = {
  adminPasswordConfigured: true,
  adminPassword: "admin-password-long-enough-2026",
  appSecretConfigured: true,
  appSecret: "a-random-application-session-secret-32chars",
  cookieSecure: true,
  encryptionKeyConfigured: true,
  databaseUrl: "mysql://waitinglist:database-password-long-enough@mariadb:3306/waitinglist",
  webhookUrl: "https://n8n.example.com/webhook/spsb",
  turnstileSiteKey: "site-key",
  turnstileSecretKey: "secret-key",
};

describe("runtime configuration safeguards", () => {
  test("accepts bounded MariaDB pool sizes and rejects unsafe values", () => {
    expect(parseDbPoolSize("10")).toBe(10);
    expect(parseDbPoolSize("1")).toBe(1);
    expect(parseDbPoolSize("100")).toBe(100);
    for (const value of ["0", "101", "1.5", "NaN", ""]) {
      expect(() => parseDbPoolSize(value)).toThrow("DB_POOL_SIZE");
    }
  });

  test("requires Turnstile site and secret keys to be configured as a pair", () => {
    expect(() => assertTurnstilePair("", "")).not.toThrow();
    expect(() => assertTurnstilePair("site-key", "secret-key")).not.toThrow();
    expect(() => assertTurnstilePair("site-key", "")).toThrow("harus diisi bersama");
    expect(() => assertTurnstilePair("", "secret-key")).toThrow("harus diisi bersama");
  });

  test("accepts valid production secrets and internal MariaDB credentials", () => {
    expect(productionSecurityProblems(secureProductionSettings)).toEqual([]);
  });

  test("requires both Turnstile keys in production", () => {
    expect(productionSecurityProblems({
      ...secureProductionSettings,
      turnstileSiteKey: "",
      turnstileSecretKey: "",
    })).toContain("TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY wajib dikonfigurasi di production");
    expect(productionSecurityProblems({
      ...secureProductionSettings,
      turnstileSecretKey: "",
    })).toContain("TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY wajib dikonfigurasi di production");
  });

  test("reports weak secrets, insecure cookies, local/root database, and HTTP webhook", () => {
    const problems = productionSecurityProblems({
      ...secureProductionSettings,
      adminPassword: "short",
      appSecret: "replace-me",
      cookieSecure: false,
      encryptionKeyConfigured: false,
      databaseUrl: "mysql://root:short@localhost:3306/waitinglist",
      webhookUrl: "http://n8n.example.com/webhook/spsb",
    });
    expect(problems).toHaveLength(7);
    expect(problems.join("; ")).toContain("COOKIE_SECURE");
    expect(problems.join("; ")).toContain("DB_HOST");
    expect(problems.join("; ")).toContain("N8N_WEBHOOK_URL harus menggunakan HTTPS");
  });

  test("rejects malformed database URLs and invalid webhook URLs", () => {
    const problems = productionSecurityProblems({
      ...secureProductionSettings,
      databaseUrl: "not-a-database-url",
      webhookUrl: "not-a-url",
    });
    expect(problems).toContain("konfigurasi koneksi MariaDB tidak valid");
    expect(problems).toContain("N8N_WEBHOOK_URL tidak valid");
  });
});
