import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OCR_OUTPUT_BYTES = 500_000;

async function run(command: string, args: string[]) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: "utf8",
    timeout: 25_000,
    maxBuffer: 3 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export type PaymentProofOcrResult = {
  format: "text" | "tsv" | "error";
  text: string;
  error: string;
};

/** Reads text locally. OCR failures are returned as data so n8n can request manual review. */
export async function extractPaymentProofText(bytes: Uint8Array, mime: string): Promise<PaymentProofOcrResult> {
  const extension = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "application/pdf" ? "pdf" : "";
  if (!extension) return { format: "error", text: "", error: "Format bukti tidak didukung." };

  let directory = "";
  try {
    directory = await mkdtemp(join(tmpdir(), "spsb-payment-ocr-"));
    const inputPath = join(directory, `proof.${extension}`);
    const pagePrefix = join(directory, "page");
    await writeFile(inputPath, bytes, { mode: 0o600 });
    if (extension === "pdf") {
      try {
        const extracted = await run("pdftotext", ["-layout", inputPath, "-"]);
        if (extracted.replace(/\s/g, "").length > 20) {
          if (Buffer.byteLength(extracted, "utf8") > MAX_OCR_OUTPUT_BYTES) throw new Error("Teks pada bukti terlalu panjang untuk diproses otomatis.");
          return { format: "text", text: extracted, error: "" };
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("terlalu panjang")) throw error;
        // Scanned PDFs need rendering before local OCR.
      }
      await run("pdftoppm", ["-f", "1", "-l", "3", "-r", "300", "-png", inputPath, pagePrefix]);
      const pages = (await readdir(directory))
        .filter(file => /^page-\d+\.png$/i.test(file))
        .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
      if (!pages.length) throw new Error("PDF tidak memiliki halaman yang dapat diproses.");
      const output: string[] = [];
      for (const page of pages) {
        output.push(await run(process.env.TESSERACT_PATH || "tesseract", [join(directory, page), "stdout", "-l", "ind+eng", "tsv"]));
      }
      const text = "__TSV__\n" + output.join("\n__TSV_PAGE__\n");
      if (Buffer.byteLength(text, "utf8") > MAX_OCR_OUTPUT_BYTES) throw new Error("Hasil OCR terlalu panjang untuk diproses otomatis.");
      return { format: "tsv", text, error: "" };
    }

    const output = await run(process.env.TESSERACT_PATH || "tesseract", [inputPath, "stdout", "-l", "ind+eng", "tsv"]);
    const text = "__TSV__\n" + output;
    if (Buffer.byteLength(text, "utf8") > MAX_OCR_OUTPUT_BYTES) throw new Error("Hasil OCR terlalu panjang untuk diproses otomatis.");
    return { format: "tsv", text, error: "" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kesalahan OCR tidak diketahui.";
    const unavailable = /ENOENT|not found|is not recognized/i.test(message);
    return {
      format: "error",
      text: "",
      error: unavailable
        ? "Tesseract OCR dan/atau Poppler belum terpasang pada server aplikasi."
        : message.slice(0, 240),
    };
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
