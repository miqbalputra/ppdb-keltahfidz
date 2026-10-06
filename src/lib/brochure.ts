import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, MAX_BROCHURE_BYTES } from "../config";

// The name and location are fixed: client-provided file names never become paths.
const brochurePath = join(DATA_DIR, "spsb-brochure.pdf");

export function validateBrochure(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > MAX_BROCHURE_BYTES) {
    throw new Error("Ukuran brosur PDF maksimal 10 MB.");
  }
  const beginning = Buffer.from(bytes.subarray(0, 8)).toString("ascii");
  const end = Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString("latin1").trimEnd();
  if (!/^%PDF-\d\.\d/.test(beginning) || !end.endsWith("%%EOF")) {
    throw new Error("Brosur harus berupa file PDF yang valid.");
  }
}

export async function brochureStatus(): Promise<{ available: boolean; size: number | null; updatedAt: string | null }> {
  try {
    const info = await stat(brochurePath);
    return info.isFile()
      ? { available: true, size: info.size, updatedAt: info.mtime.toISOString() }
      : { available: false, size: null, updatedAt: null };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { available: false, size: null, updatedAt: null };
    throw error;
  }
}

export async function readBrochure(): Promise<Buffer | null> {
  try {
    return await readFile(brochurePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveBrochure(bytes: Uint8Array): Promise<void> {
  validateBrochure(bytes);
  const temporaryPath = join(DATA_DIR, `.spsb-brochure-${randomBytes(12).toString("hex")}.tmp`);
  let written = false;
  try {
    await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await writeFile(temporaryPath, bytes, { flag: "wx", mode: 0o600 });
    written = true;
    await rename(temporaryPath, brochurePath);
  } catch (error) {
    if (written) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function deleteBrochure(): Promise<void> {
  try {
    await unlink(brochurePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
