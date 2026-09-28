import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cacheDir = await mkdtemp(join(tmpdir(), "spsb-regions-test-"));
process.env.DATA_DIR = cacheDir;
process.env.DATA_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const { getRegions } = await import("../src/lib/regions");
const originalFetch = globalThis.fetch;
type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

function useFetch(handler: FetchHandler): void {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return handler(url, init);
  }, { preconnect: originalFetch.preconnect.bind(originalFetch) });
}

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await rm(cacheDir, { recursive: true, force: true });
});

test("loads EMSIFA data, adapts it, and caches it in memory and on disk", async () => {
  let calls = 0;
  useFetch(async (url) => {
    calls += 1;
    expect(url).toBe("https://www.emsifa.com/api-wilayah-indonesia/v2/provinces.json");
    return Response.json({ data: [{ id: "32", name: " Jawa Barat " }], meta: { level: 1 } });
  });

  expect(await getRegions("provinces")).toEqual([{ id: "32", name: "Jawa Barat" }]);
  expect(await getRegions("provinces")).toEqual([{ id: "32", name: "Jawa Barat" }]);
  expect(calls).toBe(1);
  expect(JSON.parse(await readFile(join(cacheDir, "regions", "v2_provinces.json"), "utf8")))
    .toEqual([{ id: "32", name: "Jawa Barat" }]);
});

test("uses validated disk cache when upstream is unavailable", async () => {
  const cachePath = join(cacheDir, "regions", "v2_regencies_32.json");
  await mkdir(join(cacheDir, "regions"), { recursive: true });
  await writeFile(cachePath, JSON.stringify([{ id: "32.73", name: "Kota Bandung" }]));
  useFetch(async () => new Response("upstream unavailable", { status: 503 }));

  expect(await getRegions("regencies", "32")).toEqual([{ id: "32.73", name: "Kota Bandung" }]);
});

test("coalesces concurrent upstream requests and tolerates cache write failures", async () => {
  let calls = 0;
  let resolveResponse!: (response: Response) => void;
  const delayedResponse = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  useFetch(async () => {
    calls += 1;
    return delayedResponse;
  });

  const first = getRegions("districts", "32.73");
  const second = getRegions("districts", "32.73");
  resolveResponse(Response.json({ data: [{ id: "32.73.01", name: "Sukasari" }], meta: {} }));
  expect(await Promise.all([first, second])).toEqual([
    [{ id: "32.73.01", name: "Sukasari" }],
    [{ id: "32.73.01", name: "Sukasari" }],
  ]);
  expect(calls).toBe(1);

  const blockedCachePath = join(cacheDir, "regions", "v2_districts_32.74.json");
  await mkdir(blockedCachePath, { recursive: true });
  useFetch(async () => Response.json({ data: [{ id: "32.74.01", name: "Test District" }], meta: {} }));
  expect(await getRegions("districts", "32.74")).toEqual([{ id: "32.74.01", name: "Test District" }]);
});

test("rejects unsupported levels, malformed parent IDs, and unavailable uncached data", async () => {
  let calls = 0;
  useFetch(async () => {
    calls += 1;
    return new Response("upstream unavailable", { status: 503 });
  });
  await expect(getRegions("unknown")).rejects.toThrow("Jenis wilayah tidak dikenal");
  await expect(getRegions("villages", "32.73")).rejects.toThrow("ID wilayah tidak valid");
  await expect(getRegions("villages", "32.73.01")).rejects.toThrow("Data wilayah belum tersedia");
  expect(calls).toBe(1);
});
