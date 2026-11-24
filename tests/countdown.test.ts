import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function browserHarness(openingDateTime: string, start: string, initialViews = 0, pathname = "/", closingDateTime = "", initiallyClosed = false) {
  let now = new Date(start).getTime();
  let serverOpen = false;
  let serverClosed = initiallyClosed;
  let brochureAvailable = false;
  let downloads = 0;
  let previewRequests = 0;
  let totalViews = initialViews;
  let brochureStatusAvailable = true;
  let brochureDownloadFails = false;
  let copiedAccount = "";
  let interval: (() => void) | undefined;
  const timeouts = new Map<number, { fn: () => void; delay: number }>();
  let nextTimeout = 2;
  const configRequests: string[] = [];
  const nodes = new Map<string, any>();
  const classes = new Set(["config-pending"]);
  const node = (selector: string): any => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, textContent: "", value: "", disabled: false,
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), toggle: () => {} },
      listeners: {} as Record<string, () => void>,
      addEventListener(event: string, fn: () => void) { this.listeners[event] = fn; },
      setCustomValidity: () => {}, setAttribute: () => {}, removeAttribute: () => {}, focus() { this.focused = true; },
      append: () => {}, replaceChildren: () => {}, closest: () => ({ querySelector: () => null }),
      click: () => { downloads += 1; }, remove: () => {},
    });
    return nodes.get(selector);
  };
  const metric = node("#brochure-view-count");
  node("#registration-closed").hidden = true;
  const brochureDialog = node("#brochure-dialog");
  brochureDialog.showModal = () => { brochureDialog.open = true; };
  const brochureImage = node("#brochure-image");
  Object.defineProperty(brochureImage, "src", {
    set(url) {
      previewRequests += 1;
      if (url !== `/api/brochure?preview=view&open=${previewRequests}`) throw new Error("Unexpected preview URL");
      if (brochureAvailable) totalViews += 1;
      Promise.resolve().then(() => brochureImage.listeners[brochureAvailable ? "load" : "error"]());
    },
  });
  metric.hidden = true;
  // Match the real paragraph's text nodes and styled <strong>. Reading the
  // parent's textContent aggregates descendants, as it does in a browser.
  metric.childNodes = [
    { textContent: "Sudah dilihat " }, node("#brochure-view-number"), { textContent: " kali" },
  ];
  Object.defineProperty(metric, "textContent", {
    get: () => metric.childNodes.map((child: { textContent: string }) => child.textContent).join(""),
  });
  const region = node("#region-stub");
  node("#payment-account-number").textContent = "7355331193";
  const form = node("#waitinglist-form");
  form.elements = new Proxy({}, { get: (_, key: string) => node(`#input-${key}`) });
  form.querySelectorAll = (selector: string) => {
    if (selector === "select[data-region]") return [region];
    return selector === 'input[name="askar_anggota"]' ? [node("#askar-member")] : [];
  };
  form.querySelector = () => null;
  const document = {
    body: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) }, append: () => {} },
    querySelector: node,
    querySelectorAll: () => [],
    createElement: (tag: string) => node(tag === "img" ? "#brochure-image" : "#created"),
  };
  const FakeDate = class extends Date { static now() { return now; } };
  const fetch = async (url: string) => {
    if (url === "/api/brochure") {
      const ok = brochureAvailable && !brochureDownloadFails;
      return {
        ok, status: brochureDownloadFails ? 503 : brochureAvailable ? 200 : 404,
        blob: async () => new Blob(["\x89PNG\r\n\x1a\n"], { type: "image/png" }),
      };
    }
    if (url === "/api/brochure/status") return {
      ok: brochureStatusAvailable,
      json: async () => ({ available: brochureAvailable, viewCount: totalViews }),
    };
    const isConfigRequest = url.startsWith("/api/config");
    if (isConfigRequest) configRequests.push(url);
    return {
      ok: true,
      json: async () => isConfigRequest
        ? {
          cutoffDate: "2027-07-01", eligibleBirthdate: "2021-01-01", minAgeYears: 6, minAgeMonths: 6,
          openingCountdownEnabled: true, openingDateTime, registrationOpen: serverOpen, turnstileSiteKey: "",
          registrationClosed: serverClosed, closingDateTime,
        }
        : { items: [] },
    };
  };
  runInNewContext(script, {
    document, window: { location: { pathname } }, Date: FakeDate, fetch, Intl, AbortController,
    navigator: { clipboard: { writeText: async (value: string) => { copiedAccount = value; } } },
    URL: { createObjectURL: () => "blob:test-brochure", revokeObjectURL: () => {} },
    Option: class { dataset = {}; constructor(public text: string, public value: string) {} },
    setInterval: (fn: () => void) => { interval = fn; return 1; },
    clearInterval: () => { interval = undefined; },
    setTimeout: (fn: () => void, delay: number) => {
      const id = nextTimeout++;
      timeouts.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id: number) => timeouts.delete(id),
  });
  const settle = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
  const runTimeout = async (delay: number) => {
    const timeout = [...timeouts].find(([, timer]) => timer.delay === delay);
    if (!timeout) throw new Error(`No timer with delay ${delay}`);
    timeouts.delete(timeout[0]);
    timeout[1].fn();
    await settle();
  };
  return {
    node, classes, settle, configRequests,
    setTime: (time: string) => { now = new Date(time).getTime(); },
    openOnServer: () => { serverOpen = true; },
    closeOnServer: () => { serverOpen = false; serverClosed = true; },
    brochureIsAvailable: () => { brochureAvailable = true; },
    statusFails: () => { brochureStatusAvailable = false; },
    downloadFails: () => { brochureDownloadFails = true; },
    downloadCount: () => downloads,
    clickCopyAccount: async () => { await node("#copy-account-number").listeners.click(); await settle(); },
    copiedAccount: () => copiedAccount,
    previewRequests: () => previewRequests,
    openBrochure: async () => { node("#view-brochure").listeners.click(); await settle(); },
    closeBrochure: () => { brochureDialog.open = false; brochureDialog.listeners.close(); },
    downloadBrochure: async () => { node("#download-brochure").listeners.click(); await settle(); },
    tick: async () => { interval?.(); await settle(); },
    retry: () => runTimeout(5_000),
    runTimeout,
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

  test("loads the brochure on demand and counts successful previews without counting downloads", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z");
    await browser.settle();
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 0 kali");
    expect(browser.node("#brochure-view-count").hidden).toBe(false);
    expect(browser.previewRequests()).toBe(0);
    await browser.openBrochure();
    expect(browser.node("#brochure-dialog").open).toBe(true);
    expect(browser.node("#brochure-preview-status").textContent).toContain("Brosur belum dapat ditampilkan");
    expect(browser.node("#brochure-dialog-actions").hidden).toBe(true);
    expect(browser.downloadCount()).toBe(0);
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 0 kali");
    browser.closeBrochure();
    browser.brochureIsAvailable();
    await browser.openBrochure();
    expect(browser.previewRequests()).toBe(2);
    expect(browser.node("#brochure-image").hidden).toBe(false);
    expect(browser.node("#brochure-dialog-actions").hidden).toBe(false);
    expect(browser.downloadCount()).toBe(0);
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 1 kali");
    await browser.downloadBrochure();
    expect(browser.downloadCount()).toBe(1);
    expect(browser.node("#brochure-feedback").hidden).toBe(true);
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 1 kali");
    await browser.downloadBrochure();
    expect(browser.downloadCount()).toBe(2);
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 1 kali");
    browser.closeBrochure();
    await browser.openBrochure();
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 2 kali");
  });

  test("formats the persisted total in Indonesian and does not increment a failed download", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z", 1234);
    await browser.settle();
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 1.234 kali");
    browser.brochureIsAvailable();
    browser.downloadFails();
    await browser.openBrochure();
    await browser.downloadBrochure();
    expect(browser.downloadCount()).toBe(0);
    expect(browser.node("#brochure-view-count").textContent).toBe("Sudah dilihat 1.235 kali");
    expect(browser.node("#brochure-feedback").textContent).toContain("coba lagi");
    expect(browser.node("#download-brochure").disabled).toBe(false);
  });

  test("hides unavailable metrics without interfering with a successful download", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z");
    browser.statusFails();
    await browser.settle();
    expect(browser.node("#brochure-view-count").hidden).toBe(true);
    expect(browser.node("#brochure-view-number").textContent).toBe("");
    browser.brochureIsAvailable();
    await browser.openBrochure();
    await browser.downloadBrochure();
    expect(browser.downloadCount()).toBe(1);
    expect(browser.node("#brochure-feedback").hidden).toBe(true);
    expect(browser.node("#brochure-view-count").hidden).toBe(true);
    expect(browser.node("#download-brochure").disabled).toBe(false);
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

  test("uses the Askar schedule on initial load and rechecks the same path at opening", async () => {
    const start = "2026-12-31T17:00:59Z";
    const browser = browserHarness("2027-01-01T00:01", start, 0, "/askar");
    await browser.settle();
    expect(browser.configRequests).toEqual(["/api/config?jalur=askar"]);
    expect(browser.node("#countdown-route-note").hidden).toBe(false);
    expect(browser.node("#countdown-askar-link").hidden).toBe(true);
    browser.openOnServer();
    browser.setTime("2026-12-31T17:01:00Z");
    await browser.tick();
    expect(browser.configRequests).toEqual(["/api/config?jalur=askar", "/api/config?jalur=askar"]);
    expect(browser.classes.has("countdown-mode")).toBe(false);
  });

  test("shows the closure page instead of the opening countdown when the route is already closed", async () => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:00:00Z", 0, "/askar", "", true);
    await browser.settle();
    expect(browser.node("#registration-closed").hidden).toBe(false);
    expect(browser.node("#opening-countdown").hidden).toBe(true);
    expect(browser.node("#closed-askar-link").hidden).toBe(true);
    expect(browser.classes.has("registration-closed-mode")).toBe(true);
  });

  test.each([
    ["2027-01-01T00:02", 1_000],
    ["", 30_000],
  ])("shows the closure on an active page when the server reports it", async (closingDateTime, delay) => {
    const browser = browserHarness("2027-01-01T00:01", "2026-12-31T17:01:59Z", 0, "/", closingDateTime);
    browser.openOnServer();
    await browser.settle();
    expect(browser.node("#registration-closed").hidden).toBe(true);
    browser.closeOnServer();
    await browser.runTimeout(delay);
    expect(browser.node("#registration-closed").hidden).toBe(false);
    expect(browser.node("#registration-closed-title").focused).toBe(true);
  });
});
