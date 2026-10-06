import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function browserHarness(openingDateTime: string, start: string) {
  let now = new Date(start).getTime();
  let serverOpen = false;
  let brochureAvailable = false;
  let downloads = 0;
  let copiedAccount = "";
  let interval: (() => void) | undefined;
  let retry: (() => void) | undefined;
  const nodes = new Map<string, any>();
  const classes = new Set(["config-pending"]);
  const node = (selector: string): any => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, textContent: "", value: "", disabled: false,
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), toggle: () => {} },
      listeners: {} as Record<string, () => void>,
      addEventListener(event: string, fn: () => void) { this.listeners[event] = fn; },
      setCustomValidity: () => {}, setAttribute: () => {}, removeAttribute: () => {},
      replaceChildren: () => {}, closest: () => ({ querySelector: () => null }),
      click: () => { downloads += 1; }, remove: () => {},
    });
    return nodes.get(selector);
  };
  const region = node("#region-stub");
  node("#payment-account-number").textContent = "7355331193";
  const form = node("#waitinglist-form");
  form.elements = new Proxy({}, { get: (_, key: string) => node(`#input-${key}`) });
  form.querySelectorAll = (selector: string) => selector === "select[data-region]" ? [region] : [];
  const document = {
    body: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) }, append: () => {} },
    querySelector: node,
    createElement: () => node("#created"),
  };
  const FakeDate = class extends Date { static now() { return now; } };
  const fetch = async (url: string) => url === "/api/brochure" ? {
    ok: brochureAvailable, status: brochureAvailable ? 200 : 404,
    blob: async () => new Blob(["%PDF-1.7\n%%EOF"]),
  } : ({
    ok: true,
    json: async () => url === "/api/config"
      ? {
        cutoffDate: "2027-07-01", eligibleBirthdate: "2021-01-01", minAgeYears: 6, minAgeMonths: 6,
        openingCountdownEnabled: true, openingDateTime, registrationOpen: serverOpen, turnstileSiteKey: "",
      }
      : { items: [] },
  });
  runInNewContext(script, {
    document, Date: FakeDate, fetch, Intl, AbortController,
    navigator: { clipboard: { writeText: async (value: string) => { copiedAccount = value; } } },
    URL: { createObjectURL: () => "blob:test-brochure", revokeObjectURL: () => {} },
    Option: class { dataset = {}; constructor(public text: string, public value: string) {} },
    setInterval: (fn: () => void) => { interval = fn; return 1; },
    clearInterval: () => { interval = undefined; },
    setTimeout: (fn: () => void) => { retry = fn; return 2; },
  });
  const settle = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
  return {
    node, classes, settle,
    setTime: (time: string) => { now = new Date(time).getTime(); },
    openOnServer: () => { serverOpen = true; },
    brochureIsAvailable: () => { brochureAvailable = true; },
    downloadCount: () => downloads,
    clickCopyAccount: async () => { await node("#copy-account-number").listeners.click(); await settle(); },
    copiedAccount: () => copiedAccount,
    clickBrochure: async () => { node("#download-brochure").listeners.click(); await settle(); },
    tick: async () => { interval?.(); await settle(); },
    retry: async () => { retry?.(); await settle(); },
  };
}

describe("browser opening countdown", () => {
  test.each([
    ["2027-01-01T00:01", "2026-12-31T17:00:00Z"],
    ["2027-01-01T06:59", "2026-12-31T23:58:00Z"],
    ["2027-02-01T00:00", "2027-01-31T16:59:00Z"],
    ["2027-07-01T09:30", "2027-07-01T02:29:00Z"],
  ])("shows a live clock for WIB schedule %s", async (schedule, now) => {
    const browser = browserHarness(schedule, now);
    await browser.settle();
    expect(browser.node("#opening-countdown").hidden).toBe(false);
    expect(browser.node("#countdown-clock").hidden).toBe(false);
    expect(browser.node("#countdown-minutes").textContent).toBe("01");
    expect(browser.node("#countdown-schedule").textContent).toContain("WIB");
    expect(browser.classes.has("countdown-mode")).toBe(true);
    expect(browser.classes.has("config-pending")).toBe(false);
  });

  test("brochure button stays available and reports absence until a PDF is uploaded", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z");
    await browser.settle();
    await browser.clickBrochure();
    expect(browser.node("#brochure-feedback").textContent).toContain("Brosur belum tersedia");
    expect(browser.node("#download-brochure").disabled).toBe(false);
    expect(browser.downloadCount()).toBe(0);
    browser.brochureIsAvailable();
    await browser.clickBrochure();
    expect(browser.downloadCount()).toBe(1);
    expect(browser.node("#brochure-feedback").hidden).toBe(true);
  });

  test("copies the account number and announces success to assistive technology", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z");
    await browser.settle();
    await browser.clickCopyAccount();
    expect(browser.copiedAccount()).toBe("7355331193");
    expect(browser.node("#account-copy-status").textContent).toBe("Nomor rekening berhasil disalin.");
    expect(browser.node("#copy-account-number").disabled).toBe(false);
  });

  test("keeps registration hidden until server confirms the opening boundary", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:59Z");
    await browser.settle();
    expect(browser.node("#countdown-seconds").textContent).toBe("01");
    browser.setTime("2026-12-31T17:01:00Z");
    await browser.tick();
    expect(browser.classes.has("countdown-mode")).toBe(true);
    browser.openOnServer();
    await browser.retry();
    expect(browser.node("#opening-countdown").hidden).toBe(true);
    expect(browser.classes.has("countdown-mode")).toBe(false);
  });
});
