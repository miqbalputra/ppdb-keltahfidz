export interface ProductionSecuritySettings {
  adminPasswordConfigured: boolean;
  adminPassword: string;
  appSecretConfigured: boolean;
  appSecret: string;
  cookieSecure: boolean;
  encryptionKeyConfigured: boolean;
  databaseUrl: string;
  webhookUrl: string;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
}

export function parseDbPoolSize(value: string): number {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) {
    throw new Error("DB_POOL_SIZE harus berupa bilangan bulat antara 1 dan 100.");
  }
  return size;
}

export function assertTurnstilePair(siteKey: string, secretKey: string): void {
  if (Boolean(siteKey) !== Boolean(secretKey)) {
    throw new Error("TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY harus diisi bersama atau dikosongkan bersama.");
  }
}

export function productionSecurityProblems(settings: ProductionSecuritySettings): string[] {
  const problems: string[] = [];
  if (!settings.adminPasswordConfigured || settings.adminPassword.length < 16 || /^replace[-_]/i.test(settings.adminPassword)) {
    problems.push("ADMIN_PASSWORD harus unik dan minimal 16 karakter");
  }
  if (!settings.appSecretConfigured || settings.appSecret.length < 32 || /^replace[-_]/i.test(settings.appSecret)) {
    problems.push("APP_SECRET harus acak dan minimal 32 karakter");
  }
  if (!settings.cookieSecure) problems.push("COOKIE_SECURE harus true di production HTTPS");
  if (!settings.encryptionKeyConfigured) problems.push("DATA_ENCRYPTION_KEY wajib dikonfigurasi");
  if (!settings.turnstileSiteKey || !settings.turnstileSecretKey) {
    problems.push("TURNSTILE_SITE_KEY dan TURNSTILE_SECRET_KEY wajib dikonfigurasi di production");
  }

  try {
    const databaseUrl = new URL(settings.databaseUrl);
    const databaseHost = databaseUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const databaseUser = decodeURIComponent(databaseUrl.username).toLowerCase();
    const databasePassword = decodeURIComponent(databaseUrl.password);
    if (["localhost", "127.0.0.1", "::1"].includes(databaseHost)) {
      problems.push("DB_HOST harus memakai hostname internal MariaDB, bukan localhost");
    }
    if (!databaseUser || databaseUser === "root" || databasePassword.length < 20 || /^replace[-_]/i.test(databasePassword)) {
      problems.push("kredensial MariaDB harus memakai user aplikasi dan password unik minimal 20 karakter");
    }
  } catch {
    problems.push("konfigurasi koneksi MariaDB tidak valid");
  }

  if (settings.webhookUrl) {
    try {
      if (new URL(settings.webhookUrl).protocol !== "https:") {
        problems.push("N8N_WEBHOOK_URL harus menggunakan HTTPS di production");
      }
    } catch {
      problems.push("N8N_WEBHOOK_URL tidak valid");
    }
  }
  return problems;
}
