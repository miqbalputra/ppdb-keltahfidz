import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function browserHarness(openingDateTime: string, start: string) {
  let now = new Date(start).getTime();
  let serverOpen = false;
  let interval: (() => void) | undefined;
  let retry: (() => void) | undefined;
  const nodes = new Map<string, any>();
  const classes = new Set(["config-pending"]);
  const node = (selector: string): any => {
    if (!nodes.has(selector)) nodes.set(selector, {
      hidden: false, textContent: "", value: "", disabled: false,
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name), toggle: () => {} },
      addEventListener: () => {}, setCustomValidity: () => {}, setAttribute: () => {}, removeAttribute: () => {},
      replaceChildren: () => {}, closest: () => ({ querySelector: () => null }),
    });
    return nodes.get(selector);
  };
  const region = node("#region-stub");
  const form = node("#waitinglist-form");
  form.elements = new Proxy({}, { get: (_, key: string) => node(`#input-${key}`) });
  form.querySelectorAll = (selector: string) => selector === "select[data-region]" ? [region] : [];
  const document = {
    body: { classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) } },
    querySelector: node,
    createElement: () => node("#created"),
  };
  const FakeDate = class extends Date { static now() { return now; } };
  const fetch = async (url: string) => ({
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
