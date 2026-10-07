import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryData = await mkdtemp(join(tmpdir(), "spsb-brochure-test-"));
process.env.DATA_DIR = temporaryData;
process.env.ADMIN_USERNAME = "brochure-test-admin";
process.env.ADMIN_PASSWORD = "brochure-test-password";
process.env.APP_SECRET = "brochure-test-secret-with-at-least-32-characters";
process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { app } = await import("../src/index");
const { readBrochure, saveBrochure, validateBrochure, brochureStatus, detectBrochureMime } = await import("../src/lib/brochure");

afterAll(async () => { await rm(temporaryData, { recursive: true, force: true }); });

const url = (path: string) => `http://localhost${path}`;
function jpeg(label: string) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(label)]);
}
function png(label: string) {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]);
}
function upload(bytes: Uint8Array, headers: Record<string, string> = {}) {
  const mime = detectBrochureMime(bytes);
  const extension = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "pdf";
  const data = new FormData();
  data.append("brochure", new Blob([new Uint8Array(bytes)], { type: mime ?? "application/pdf" }), `brosur.${extension}`);
  return app.handle(new Request(url("/api/admin/brochure"), {
    method: "POST", headers: { host: "localhost", origin: "http://localhost", ...headers }, body: data,
  }));
}

describe("admin brochure and public download", () => {
  test("accepts only JPG/PNG signatures and rejects invalid or oversize files without replacing the current image", async () => {
    expect(detectBrochureMime(jpeg("test"))).toBe("image/jpeg");
    expect(detectBrochureMime(png("test"))).toBe("image/png");
    expect(() => validateBrochure(Buffer.from("%PDF-1.7\n%%EOF"))).toThrow("JPG atau PNG");
    expect(() => validateBrochure(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow("maksimal 10 MB");
    await saveBrochure(png("original"));
    await expect(saveBrochure(Buffer.from("not an image"))).rejects.toThrow("JPG atau PNG");
    expect((await readBrochure())?.toString()).toContain("original");
    expect((await readdir(temporaryData)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
  });

  test("requires admin/CSRF/origin for upload and deletion; downloads JPG/PNG replacements and handles missing brochure", async () => {
    const { deleteBrochure } = await import("../src/lib/brochure");
    await deleteBrochure();
    const absent = await app.handle(new Request(url("/api/brochure")));
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ error: "Brosur belum tersedia." });
    expect(await (await app.handle(new Request(url("/api/brochure/status")))).json()).toEqual({ available: false });
    expect((await app.handle(new Request(url("/api/admin/brochure")))).status).toBe(401);
    expect((await upload(jpeg("first"))).status).toBe(401);

    const login = await app.handle(new Request(url("/api/admin/login"), {
      method: "POST", headers: { host: "localhost", origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ username: "brochure-test-admin", password: "brochure-test-password" }),
    }));
    expect(login.status).toBe(200);
    const { csrfToken } = await login.json() as { csrfToken: string };
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await upload(jpeg("first"), { cookie })).status).toBe(403);
    const crossOrigin = await app.handle(new Request(url("/api/admin/brochure"), {
      method: "POST", headers: { host: "localhost", origin: "https://bad.example", cookie, "x-csrf-token": csrfToken },
      body: (() => { const data = new FormData(); data.append("brochure", new Blob([png("first")], { type: "image/png" }), "brochure.png"); return data; })(),
    }));
    expect(crossOrigin.status).toBe(403);
    const headers = { cookie, "x-csrf-token": csrfToken };
    expect((await upload(Buffer.from("%PDF-1.7\n%%EOF"), headers)).status).toBe(400);
    expect(await brochureStatus()).toMatchObject({ available: false });
    const tooLarge = await upload(jpeg("first"), { ...headers, "content-length": String(10 * 1024 * 1024 + 128 * 1024 + 1) });
    expect(tooLarge.status).toBe(413);
    const oversizedImage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(oversizedImage, headers)).status).toBe(400);
    expect(await brochureStatus()).toMatchObject({ available: false });
    expect((await upload(png("first"), headers)).status).toBe(200);
    expect(await (await app.handle(new Request(url("/api/brochure/status")))).json()).toEqual({ available: true });
    expect(await (await app.handle(new Request(url("/api/admin/brochure"), { headers: { cookie } }))).json())
      .toMatchObject({ available: true, size: png("first").length });
    const first = await app.handle(new Request(url("/api/brochure")));
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toContain("image/png");
    expect(first.headers.get("content-disposition")).toContain('attachment; filename="brosur-spsb-2027.png"');
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await first.arrayBuffer()).equals(png("first"))).toBe(true);

    expect((await upload(jpeg("latest"), headers)).status).toBe(200);
    const latest = await app.handle(new Request(url("/api/brochure")));
    expect(latest.headers.get("content-type")).toContain("image/jpeg");
    expect(latest.headers.get("content-disposition")).toContain('attachment; filename="brosur-spsb-2027.jpg"');
    expect(Buffer.from(await latest.arrayBuffer()).equals(jpeg("latest"))).toBe(true);
    expect((await readdir(temporaryData)).filter((file) => file.endsWith(".tmp"))).toEqual([]);
    expect((await app.handle(new Request(url("/api/admin/brochure"), { method: "DELETE", headers: { host: "localhost", cookie, origin: "http://localhost" } }))).status).toBe(403);
    expect((await app.handle(new Request(url("/api/admin/brochure"), { method: "DELETE", headers: { host: "localhost", ...headers, origin: "https://bad.example" } }))).status).toBe(403);
    expect((await app.handle(new Request(url("/api/admin/brochure"), { method: "DELETE", headers: { host: "localhost", origin: "http://localhost" } }))).status).toBe(401);
    expect((await app.handle(new Request(url("/api/admin/brochure"), { method: "DELETE", headers: { host: "localhost", ...headers, origin: "http://localhost" } }))).status).toBe(200);
    expect((await app.handle(new Request(url("/api/brochure")))).status).toBe(404);
    expect(await (await app.handle(new Request(url("/api/brochure/status")))).json()).toEqual({ available: false });
  });
});
