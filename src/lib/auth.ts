import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { APP_SECRET, COOKIE_SECURE, NODE_ENV, SESSION_COOKIE } from "../config";

const SESSION_TTL_SECONDS = 4 * 60 * 60;

export interface AdminSession {
  username: string;
  csrfToken: string;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftHash = createHmac("sha256", APP_SECRET).update(left).digest();
  const rightHash = createHmac("sha256", APP_SECRET).update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? "; Secure" : ""}`;
}

export function originIsSame(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return NODE_ENV !== "production";
  try {
    return new URL(origin).host.toLowerCase() === (request.headers.get("host") ?? "").toLowerCase();
  } catch {
    return false;
  }
}

export function csrfMatches(session: AdminSession, supplied: string | null): boolean {
  return Boolean(supplied && constantTimeEqual(session.csrfToken, supplied));
}

export function clientIp(request: Request): string {
  const candidate = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "";
  const address = candidate.trim();
  return isIP(address) ? address.toLowerCase() : "unknown";
}

const rateStore = new Map<string, number[]>();
let nextRateCleanup = 0;

export function allowedRate(key: string, maximum: number, periodSeconds: number): boolean {
  const now = Date.now();
  if (now >= nextRateCleanup) {
    const staleBefore = now - 15 * 60 * 1000;
    for (const [storedKey, timestamps] of rateStore) {
      if (!timestamps.some((timestamp) => timestamp >= staleBefore)) rateStore.delete(storedKey);
    }
    nextRateCleanup = now + 60 * 1000;
  }
  if (!rateStore.has(key) && rateStore.size >= 10_000) return false;
  const recent = (rateStore.get(key) ?? []).filter((timestamp) => now - timestamp < periodSeconds * 1000);
  if (recent.length >= maximum) {
    rateStore.set(key, recent);
    return false;
  }
  recent.push(now);
  rateStore.set(key, recent);
  return true;
}
