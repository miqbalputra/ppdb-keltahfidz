export interface RegionItem {
  id: string;
  name: string;
}

const REGION_ID_PATTERN = /^(?:\d{2}|\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{2}|\d{2}\.\d{2}\.\d{2}\.\d{4})$/;
const REGION_PARENT_PATTERNS: Record<string, RegExp> = {
  regencies: /^\d{2}$/,
  districts: /^\d{2}\.\d{2}$/,
  villages: /^\d{2}\.\d{2}\.\d{2}$/,
};

export function isValidRegionParentId(level: string, parentId: string): boolean {
  return REGION_PARENT_PATTERNS[level]?.test(parentId) ?? false;
}

export function parseRegionPayload(payload: unknown): RegionItem[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Respons API wilayah tidak valid.");
  }

  const envelope = payload as { data?: unknown; meta?: unknown };
  if (!Array.isArray(envelope.data) || !envelope.meta || typeof envelope.meta !== "object") {
    throw new Error("Respons API wilayah tidak valid.");
  }

  return envelope.data.map((item): RegionItem => {
    if (!item || typeof item !== "object") {
      throw new Error("Respons API wilayah tidak valid.");
    }
    const value = item as { id?: unknown; name?: unknown };
    if (typeof value.id !== "string" || !REGION_ID_PATTERN.test(value.id)
      || typeof value.name !== "string" || !value.name.trim()) {
      throw new Error("Respons API wilayah tidak valid.");
    }
    return { id: value.id, name: value.name.trim() };
  });
}

export function isCachedRegionList(value: unknown): value is RegionItem[] {
  return Array.isArray(value) && value.every((item) => item
    && typeof item.id === "string" && REGION_ID_PATTERN.test(item.id)
    && typeof item.name === "string" && Boolean(item.name.trim()));
}
