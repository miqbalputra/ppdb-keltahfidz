import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const pages = ["index.html", "admin.html", "success.html"];

async function pageSource(page: string): Promise<string> {
  return readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
}

async function stylesheet(): Promise<string> {
  return readFile(new URL("../public/app.css", import.meta.url), "utf8");
}

function colorToken(css: string, name: string): string {
  const value = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  if (!value) throw new Error(`Missing CSS color token ${name}`);
  return value;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16) / 255);
    const linear = channels.map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function attributes(source: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`\\b${escaped}=["']([^"']*)["']`, "g"))]
    .map((match) => match[1]);
}

describe("frontend accessibility contracts", () => {
  for (const page of pages) {
    test(`${page} has unique IDs and valid in-page/ARIA references`, async () => {
      const html = await pageSource(page);
      expect(html).toContain('href="/favicon.svg"');
      expect(html).toContain('name="description"');
      const ids = attributes(html, "id");
      const idSet = new Set(ids);
      expect(idSet.size).toBe(ids.length);

      for (const attribute of ["aria-describedby", "aria-labelledby", "aria-controls"]) {
        for (const value of attributes(html, attribute)) {
          for (const id of value.split(/\s+/).filter(Boolean)) expect(idSet.has(id)).toBe(true);
        }
      }
      for (const target of [...html.matchAll(/\bhref="#([^"']+)"/g)].map((match) => match[1])) {
        expect(idSet.has(target)).toBe(true);
      }
    });
  }

  test("public form has a keyboard skip link, explicit validation summary, and live status", async () => {
    const html = await pageSource("index.html");
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('id="validation-summary"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('id="waitinglist-form"');
    expect(html).toContain('name="jenis_kelamin" type="radio" value="putra" required');
    expect(html).toContain('name="jenis_kelamin" type="radio" value="putri"');
    expect(html).toContain('id="sekolah-asal" name="sekolah_asal" type="text"');
    expect(html).toContain("Contoh: TAUD Griya Qur'an");
    expect(html).toContain("Kirim Bukti Biaya Pendaftaran");
    expect(html).toContain("Saya sudah kirim bukti transfer biaya pendaftaran Rp. 150.000.");
    expect(html).toContain('id="bukti-transfer" name="bukti_transfer" type="file"');
    expect(html).toContain('accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"');
    expect(html).toContain("Upload Bukti Transfer");
    expect(html).toContain('id="konfirmasi-ketentuan-biaya" name="konfirmasi_ketentuan_biaya" type="checkbox"');
    expect(html).toContain("Saya menyatakan setuju bahwa biaya pendaftaran digunakan untuk keperluan administrasi SPSB 2027.");
    expect(html).toContain("Apabila saya mengundurkan diri setelah melakukan pembayaran, maka biaya tersebut tidak dapat dikembalikan dengan alasan apa pun.");
    expect(html).toContain("SISTEM PENERIMAAN SANTRI BARU");
    expect(html).toContain("Kelompok Tahfidz <em>Griya Qur'an Tunas Ilmu</em>");
    expect(html).toContain("Isi data dengan teliti pada form di bawah ini.");
    expect(html).toContain("Pastikan data sudah benar sebelum dikirim ke panitia.");
    expect(html).toContain("Tanggal lahir minimal <b id=\"deadline-label\">1 Januari 2021</b> atau sebelum tanggal tersebut.");
    expect(html).toContain("Periksa kembali data, kemudian kirim formulir.");
    expect(html).toContain("Halaman ini adalah formulir pendaftaran, bukan penentu hasil seleksi.");
    expect(html).toContain("Formulir pendaftaran santri baru");
    expect(html).toContain("Kirim pendaftaran");
    expect(html).toContain("Data boleh digunakan untuk keperluan informasi dan pendataan SPSB 2027.");
    expect(html).not.toContain("pendaftaran minat, bukan pendaftaran resmi");
    expect(html).toContain('id="turnstile-status"');
  });

  test("success confirmation states that registration was received, not selected", async () => {
    const html = await pageSource("success.html");
    expect(html).toContain("PENDAFTARAN SPSB 2027 TERKIRIM");
    expect(html).toContain("bukan pengumuman hasil seleksi");
    expect(html).not.toContain("Data waitinglist");
  });

  test("admin table has a caption and scoped column headers", async () => {
    const html = await pageSource("admin.html");
    expect(html).toContain("<caption");
    expect(attributes(html, "scope").filter((value) => value === "col").length).toBeGreaterThan(0);
    expect(html).toContain('aria-label="Navigasi dashboard"');
  });

  test("primary palette text colors meet WCAG AA contrast on their intended surfaces", async () => {
    const css = await stylesheet();
    const white = colorToken(css, "--paper");
    const soft = colorToken(css, "--surface-muted");
    for (const token of ["--ink", "--text-secondary", "--green"]) {
      expect(contrastRatio(colorToken(css, token), white)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrastRatio(colorToken(css, "--green-dark"), soft)).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.radio-option input:checked \+ span\s*\{[^}]*color:\s*var\(--white\)[^}]*background:\s*var\(--green-dark\)/);
    expect(contrastRatio(colorToken(css, "--white"), colorToken(css, "--green-dark"))).toBeGreaterThanOrEqual(4.5);
  });
});
