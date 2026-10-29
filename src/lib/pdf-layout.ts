import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PageSizes, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";

const green = rgb(0.16, 0.32, 0.24), ink = rgb(0.12, 0.17, 0.15), muted = rgb(0.34, 0.40, 0.37);
const pale = rgb(0.94, 0.96, 0.95), line = rgb(0.84, 0.88, 0.86);
const root = resolve(import.meta.dir, "../..");
const assetBytes = Promise.all([readFile(resolve(root, "assets/fonts/NotoSans-Regular.ttf")),
  readFile(resolve(root, "assets/fonts/NotoSans-Bold.ttf")), readFile(resolve(root, "public/logo-gq.png"))]);

export class PdfLayout {
  page!: PDFPage;
  y = 0;
  readonly margin = 38;
  private pages: PDFPage[] = [];
  private charset: Set<number>;
  private constructor(readonly doc: PDFDocument, readonly regular: PDFFont, readonly bold: PDFFont,
    readonly logo: PDFImage, readonly title: string, readonly landscape: boolean, readonly createdAt: string) {
    this.charset = new Set(regular.getCharacterSet()); this.newPage();
  }
  static async create(title: string, landscape = false, createdAt = new Date().toISOString()) {
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
    const [regular, bold, logo] = await assetBytes;
    doc.setTitle(title); doc.setAuthor("Griya Qur'an Tunas Ilmu"); doc.setSubject("SPSB 2027 - Dokumen internal panitia");
    return new PdfLayout(doc, await doc.embedFont(regular, { subset: true }), await doc.embedFont(bold, { subset: true }),
      await doc.embedPng(logo), title, landscape, createdAt);
  }
  get width() { return this.page.getWidth() - this.margin * 2; }
  private safe(value: unknown) {
    const text = String(value ?? "").normalize("NFC").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
      .replace(/[\u2010-\u2015]/g, "-");
    return Array.from(text, c => {
        if (c === "\n" || this.charset.has(c.codePointAt(0)!)) return c;
        const fallback = c.normalize("NFKD").replace(/\p{Mark}/gu, "");
        return [...fallback].every(char => this.charset.has(char.codePointAt(0)!)) ? fallback : "?";
      }).join("");
  }
  private wrap(value: unknown, width: number, size = 9, font = this.regular) {
    const text = this.safe(value) || "-"; const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let current = "";
      for (const word of paragraph.split(/\s+/)) {
        const next = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) { current = next; continue; }
        if (current) lines.push(current); current = "";
        for (const c of word) {
          if (current && font.widthOfTextAtSize(current + c, size) > width) { lines.push(current); current = ""; }
          current += c;
        }
      }
      if (current || !paragraph) lines.push(current);
    }
    return lines;
  }
  newPage() {
    const [w, h] = PageSizes.A4;
    this.page = this.doc.addPage(this.landscape ? [h, w] : [w, h]); this.pages.push(this.page);
    const top = this.page.getHeight();
    this.page.drawRectangle({ x: 0, y: top - 76, width: this.page.getWidth(), height: 76, color: green });
    this.page.drawImage(this.logo, { x: this.margin, y: top - 60, width: 40, height: 40 });
    this.page.drawText("GRIYA QUR'AN TUNAS ILMU", { x: this.margin + 52, y: top - 33, font: this.bold, size: 12, color: rgb(1, 1, 1) });
    this.page.drawText("Sistem Pendaftaran Santri Baru 2027", { x: this.margin + 52, y: top - 51, font: this.regular, size: 9, color: rgb(0.88, 0.94, 0.90) });
    this.y = top - 100;
    this.page.drawText(this.safe(this.title), { x: this.margin, y: this.y, font: this.bold, size: 15, color: green });
    this.y -= 22;
  }
  private space(height: number) { if (this.y - height < 45) this.newPage(); }
  paragraph(value: string, size = 9) {
    for (const text of this.wrap(value, this.width, size)) {
      this.space(size + 5); this.page.drawText(text, { x: this.margin, y: this.y, font: this.regular, size, color: muted }); this.y -= size + 5;
    }
    this.y -= 5;
  }
  section(title: string) {
    this.space(100); this.y -= 7;
    this.page.drawRectangle({ x: this.margin, y: this.y - 6, width: this.width, height: 24, color: pale });
    this.page.drawText(this.safe(title), { x: this.margin + 9, y: this.y + 2, font: this.bold, size: 9, color: green }); this.y -= 25;
  }
  fields(values: Array<[string, string]>) {
    const gap = 22, width = (this.width - gap) / 2;
    for (let i = 0; i < values.length; i += 2) {
      const pairs = values.slice(i, i + 2);
      const lines = pairs.map(([, value]) => this.wrap(value, width, 10));
      const height = 14 + Math.max(...lines.map(l => l.length)) * 13 + 9;
      if (height > this.page.getHeight() - 180) {
        for (const [label, value] of pairs) { this.section(label); this.paragraph(value, 10); }
        continue;
      }
      this.space(height);
      pairs.forEach(([label], c) => {
        const x = this.margin + c * (width + gap);
        this.page.drawText(this.safe(label), { x, y: this.y, font: this.bold, size: 8, color: muted });
        lines[c]!.forEach((value, n) => this.page.drawText(value, { x, y: this.y - 14 - n * 13, font: this.regular, size: 10, color: ink }));
      });
      this.y -= height;
    }
  }
  table(headers: string[], rows: Array<Array<string | number>>, proportions?: number[]) {
    const total = proportions?.reduce((a, b) => a + b, 0) || headers.length;
    const widths = headers.map((_, i) => this.width * (proportions?.[i] || 1) / total);
    const headerLines = headers.map((text, i) => this.wrap(text, widths[i]! - 12, 8, this.bold));
    const headerHeight = Math.max(...headerLines.map(l => l.length)) * 11 + 12;
    const drawHeader = () => {
      this.space(headerHeight + 30);
      this.page.drawRectangle({ x: this.margin, y: this.y - headerHeight + 5, width: this.width, height: headerHeight, color: green });
      let x = this.margin;
      headerLines.forEach((lines, c) => { lines.forEach((v, i) => this.page.drawText(v, { x: x + 6, y: this.y - 7 - i * 11, font: this.bold, size: 8, color: rgb(1, 1, 1) })); x += widths[c]!; });
      this.y -= headerHeight;
    };
    drawHeader();
    const data = rows.length ? rows : [headers.map((_, i) => i ? "" : "Tidak ada data sesuai filter")];
    data.forEach((values, rowIndex) => {
      const cells = headers.map((_, i) => this.wrap(values[i] ?? "", widths[i]! - 12, 9));
      let remaining = Math.max(...cells.map(l => l.length)), offset = 0;
      while (remaining > 0) {
        if (this.y < 75) { this.newPage(); drawHeader(); }
        const available = Math.max(1, Math.floor((this.y - 53) / 13));
        const count = Math.min(remaining, available), height = count * 13 + 10;
        if (rowIndex % 2 === 0) this.page.drawRectangle({ x: this.margin, y: this.y - height + 5, width: this.width, height, color: pale });
        let x = this.margin;
        cells.forEach((lines, c) => { lines.slice(offset, offset + count).forEach((value, n) => this.page.drawText(value, {
          x: x + 6, y: this.y - 9 - n * 13, font: this.regular, size: 9, color: ink })); x += widths[c]!; });
        this.y -= height;
        this.page.drawLine({ start: { x: this.margin, y: this.y + 5 }, end: { x: this.margin + this.width, y: this.y + 5 }, color: line, thickness: 0.5 });
        offset += count; remaining -= count;
        if (remaining) { this.newPage(); drawHeader(); }
      }
    });
    this.y -= 12;
  }
  async save() {
    const timestamp = new Date(this.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
    this.pages.forEach((page, i) => {
      page.drawLine({ start: { x: this.margin, y: 35 }, end: { x: page.getWidth() - this.margin, y: 35 }, color: line, thickness: 0.5 });
      page.drawText(`Internal panitia SPSB 2027 | ${timestamp} WIB`, { x: this.margin, y: 22, font: this.regular, size: 7, color: muted });
      page.drawText(`${i + 1} / ${this.pages.length}`, { x: page.getWidth() - this.margin - 36, y: 22, font: this.regular, size: 8, color: muted });
    });
    return this.doc.save();
  }
}
