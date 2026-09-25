import { mkdir, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DATA_DIR } from "../config";
import { isCachedRegionList, isValidRegionParentId, parseRegionPayload, type RegionItem } from "./region-payload";

const REGION_API_BASE = "https://www.emsifa.com/api-wilayah-indonesia/v2";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const memoryCache = new Map<string, { createdAt: number; items: RegionItem[] }>();
const inflightLoads = new Map<string, Promise<RegionItem[]>>();

export { parseRegionPayload } from "./region-payload";
export type { RegionItem } from "./region-payload";

export async function getRegions(level: string, parentId = ""): Promise<RegionItem[]> {
  const endpoints: Record<string, { endpoint: string; key: string }> = {
    provinces: { endpoint: "provinces.json", key: "v2_provinces" },
    regencies: { endpoint: `regencies/${parentId}.json`, key: `v2_regencies_${parentId}` },
    districts: { endpoint: `districts/${parentId}.json`, key: `v2_districts_${parentId}` },
    villages: { endpoint: `villages/${parentId}.json`, key: `v2_villages_${parentId}` },
  };
  const target = endpoints[level];
  if (!target) throw new Error("Jenis wilayah tidak dikenal.");
  if (level !== "provinces" && !isValidRegionParentId(level, parentId)) {
    throw new Error("ID wilayah tidak valid.");
  }

  const now = Date.now();
  const cached = memoryCache.get(target.key);
  if (cached && now - cached.createdAt < CACHE_TTL_MS) return cached.items;
  const inflight = inflightLoads.get(target.key);
  if (inflight) return inflight;

  const cachePath = join(DATA_DIR, "regions", `${target.key}.json`);
  const load = (async (): Promise<RegionItem[]> => {
    try {
      const response = await fetch(`${REGION_API_BASE}/${target.endpoint}`, {
        headers: { "user-agent": "SPSB-Waitinglist/1.0", accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`API wilayah memberi status ${response.status}.`);
      const items = parseRegionPayload(await response.json());
      memoryCache.set(target.key, { createdAt: Date.now(), items });

      // Cache persistence is best-effort: filesystem trouble must not discard a valid API response.
      const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
      try {
        await mkdir(join(DATA_DIR, "regions"), { recursive: true });
        await Bun.write(temporaryPath, JSON.stringify(items));
        await rename(temporaryPath, cachePath);
      } catch {
        console.warn(`Region cache could not be persisted for ${level}.`);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      return items;
    } catch {
      if (cached) {
        memoryCache.set(target.key, { createdAt: Date.now(), items: cached.items });
        return cached.items;
      }
      try {
        const file = Bun.file(cachePath);
        if (await file.exists()) {
          const items: unknown = await file.json();
          if (isCachedRegionList(items)) {
            memoryCache.set(target.key, { createdAt: Date.now(), items });
            return items;
          }
        }
      } catch {
        // Report the same safe user-facing error when both upstream and cache are unavailable.
      }
      throw new Error("Data wilayah belum tersedia. Silakan coba beberapa saat lagi.");
    }
  })();
  inflightLoads.set(target.key, load);
  try {
    return await load;
  } finally {
    if (inflightLoads.get(target.key) === load) inflightLoads.delete(target.key);
  }
}
