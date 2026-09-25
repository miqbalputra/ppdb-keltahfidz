import { describe, expect, test } from "bun:test";
import { isValidRegionParentId, parseRegionPayload } from "../src/lib/region-payload";

describe("EMSIFA v2 region responses", () => {
  test("unwraps the data/meta envelope and preserves hierarchical IDs", () => {
    const items = parseRegionPayload({
      data: [
        { id: "32", name: "Jawa Barat", capital: "Bandung" },
        { id: "32.73", name: "Kota Bandung", province: { id: "32" } },
        { id: "32.73.01", name: "Sukasari", lat: -6.86 },
        { id: "32.73.01.1001", name: "Sukarasa", postal_code: "40152" },
      ],
      meta: { level: 2, updated_at: "2026-09-20" },
    });

    expect(items).toEqual([
      { id: "32", name: "Jawa Barat" },
      { id: "32.73", name: "Kota Bandung" },
      { id: "32.73.01", name: "Sukasari" },
      { id: "32.73.01.1001", name: "Sukarasa" },
    ]);
  });

  test("rejects the legacy array response and malformed v2 records", () => {
    expect(() => parseRegionPayload([{ id: "32", name: "Jawa Barat" }])).toThrow();
    expect(() => parseRegionPayload({
      data: [{ id: "3273", name: "Kota Bandung" }],
      meta: { level: 2 },
    })).toThrow();
    expect(() => parseRegionPayload({
      data: [{ id: "32.73", name: "  " }],
      meta: { level: 2 },
    })).toThrow();
  });

  test("validates IDs at each cascading level", () => {
    expect(isValidRegionParentId("regencies", "32")).toBe(true);
    expect(isValidRegionParentId("districts", "32.73")).toBe(true);
    expect(isValidRegionParentId("villages", "32.73.01")).toBe(true);
    expect(isValidRegionParentId("villages", "32.73")).toBe(false);
    expect(isValidRegionParentId("districts", "32.73.01")).toBe(false);
    expect(isValidRegionParentId("other", "32")).toBe(false);
  });
});
