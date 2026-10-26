import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const script = await readFile(new URL("../public/admin.js", import.meta.url), "utf8");

function dashboardHarness(includeParticipant = false, archivedParticipant = false) {
  const nodes = new Map<string, any>();
  const makeNode = (selector: string): any => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        selector, hidden: false, disabled: false, textContent: "", value: "", checked: false,
        className: "", listeners: {} as Record<string, (event?: any) => void>,
        classList: { toggle: () => {}, add: () => {}, remove: () => {} },
        addEventListener(event: string, callback: (event?: any) => void) { this.listeners[event] = callback; },
        setAttribute: () => {}, removeAttribute: () => {}, replaceChildren(...children: any[]) { this.children = children; },
        append(...children: any[]) { (this.children ??= []).push(...children); },
        appendChild(child: any) { (this.children ??= []).push(child); return child; },
        querySelector: (child: string) => makeNode(`${selector} ${child}`),
        focus: () => {}, showModal() { this.open = true; }, close() { this.open = false; },
      });
    }
    return nodes.get(selector);
  };
  const settings = makeNode("#settings-form");
  settings.elements = new Proxy({}, { get: (_, key: string) => makeNode(`#settings-${key}`) });
  makeNode("#login-card").querySelector = (selector: string) => makeNode(`#login-card ${selector}`);
  makeNode("#dashboard").querySelector = (selector: string) => makeNode(`#dashboard ${selector}`);
  class TestFormData { constructor(_form?: unknown) {} *[Symbol.iterator]() { yield* []; } }
  const participantId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const participant = {
    id: participantId, nama_anak: "Amina Zahra", jenis_kelamin: "putri", sekolah_asal: "TK Tunas",
    tanggal_lahir_anak: "2021-01-01", umur_terhitung_bulan: 72, status_eligibility: "eligible",
    nama_ortu: "Siti Aminah", status_ortu: "ibu", no_hp_wa: "6281234567890", email: "siti@example.test",
    desa_nama: "Desa A", kecamatan_nama: "Kecamatan B", kabupaten_nama: "Kabupaten C", provinsi_nama: "Jawa Barat",
    konfirmasi_data: 1, konfirmasi_bukti_transfer: 1, konfirmasi_ketentuan_biaya: 1,
    has_proof: true, created_at: "2027-01-01T00:00:00.000Z",
    deleted_at: archivedParticipant ? "2027-01-02T00:00:00.000Z" : null,
    deleted_by: archivedParticipant ? "admin" : null,
  };
  const requests: Array<{ path: string; method: string }> = [];
  const fetch = async (path: string, options: RequestInit = {}) => {
    requests.push({ path, method: options.method ?? "GET" });
    const payload = path === "/api/admin/me"
      ? { authenticated: true, csrfToken: "csrf" }
      : path === "/api/admin/system"
        ? {
          app: { status: "online", runtime: "Bun test", uptimeSeconds: 60 },
          database: { status: "online" }, integrations: { n8nConfigured: false, turnstileEnabled: true },
          settings: {
            cutoffDate: "2027-07-01", minAgeYears: 6, minAgeMonths: 6,
            whatsappGroupUrl: "https://chat.whatsapp.com/saved", openingCountdownEnabled: false, openingDateTime: "",
          }, settingsUpdatedAt: "2027-01-01T00:00:00.000Z",
        }
        : path === "/api/admin/brochure"
          ? { available: false }
          : path === `/api/admin/waitinglist/${participantId}`
            ? participant
            : path.startsWith("/api/admin/waitinglist?")
              ? { rows: includeParticipant ? [{
                id: participantId, nama_anak: participant.nama_anak, nama_ortu: participant.nama_ortu,
                status_ortu: participant.status_ortu, jenis_kelamin: participant.jenis_kelamin,
                sekolah_asal: participant.sekolah_asal, umur_terhitung_bulan: participant.umur_terhitung_bulan,
                status_eligibility: participant.status_eligibility, desa_nama: participant.desa_nama,
                kecamatan_nama: participant.kecamatan_nama, has_proof: participant.has_proof,
                konfirmasi_ketentuan_biaya: 1, created_at: participant.created_at,
              }] : [], total: includeParticipant ? 1 : 0, page: 1, pages: 1 }
            : {
              total: 0, registrationPeriod: { label: "Semua pendaftar" },
              gender: { putra: 0, putri: 0, unrecorded: 0 },
              eligibilityAtSubmission: { eligible: 0, notEligible: 0 }, daily: [], topDistricts: [],
            };
    return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => payload };
  };
  runInNewContext(script, {
    document: { querySelector: makeNode, createElement: (tag: string) => makeNode(`created:${tag}`) },
    fetch, FormData: TestFormData, AbortController, URLSearchParams, Intl,
    window: { confirm: () => true, location: { assign: () => {} } },
  });
  const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
  return { node: makeNode, settle, participantId, requests };
}

describe("admin settings draft safety", () => {
  test("loads one participant's private detail only when requested and labels registration snapshots accurately", async () => {
    const browser = dashboardHarness(true);
    await browser.settle();
    await browser.node("created:button").listeners.click();
    await browser.settle();
    expect(browser.node("#participant-dialog").open).toBe(true);
    expect(browser.node("#participant-dialog-title").textContent).toBe("Amina Zahra");
    expect(browser.node("#detail-phone").textContent).toBe("6281234567890");
    expect(browser.node("#detail-eligibility").textContent).toBe("Memenuhi kriteria saat mendaftar");
    expect(browser.node("#detail-transfer-consent").textContent).toContain("bukan verifikasi pembayaran panitia");
    expect(browser.node("#detail-proof-link").hidden).toBe(false);
    expect(browser.node("#detail-pdf-link").href).toContain(`${browser.participantId}/export.pdf`);
  });

  test("archives a participant only after explicit confirmation and refreshes the active list", async () => {
    const browser = dashboardHarness(true);
    await browser.settle();
    await browser.node("created:button").listeners.click();
    await browser.settle();
    await browser.node("#archive-participant-button").listeners.click();
    await browser.settle();
    expect(browser.requests).toContainEqual({
      path: `/api/admin/waitinglist/${browser.participantId}/archive`, method: "POST",
    });
    expect(browser.node("#participant-dialog").open).toBe(false);
  });

  test("shows restore instead of delete for an archived participant", async () => {
    const browser = dashboardHarness(true, true);
    await browser.settle();
    await browser.node("created:button").listeners.click();
    await browser.settle();
    expect(browser.node("#archive-participant-button").hidden).toBe(true);
    expect(browser.node("#restore-participant-button").hidden).toBe(false);
    await browser.node("#restore-participant-button").listeners.click();
    await browser.settle();
    expect(browser.requests).toContainEqual({
      path: `/api/admin/waitinglist/${browser.participantId}/restore`, method: "POST",
    });
    expect(browser.node("#participant-dialog").open).toBe(false);
  });

  test("refreshing system status never overwrites an unsaved settings edit", async () => {
    const browser = dashboardHarness();
    await browser.settle();
    const cutoff = browser.node("#settings-cutoffDate");
    expect(cutoff.value).toBe("2027-07-01");
    cutoff.value = "2027-06-30";
    browser.node("#settings-form").listeners.input();
    await browser.node("#refresh-system").listeners.click();
    await browser.settle();
    expect(cutoff.value).toBe("2027-06-30");
    expect(browser.node("#settings-updated").textContent).toContain("belum disimpan");
  });
});
