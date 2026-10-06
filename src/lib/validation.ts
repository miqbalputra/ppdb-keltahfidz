export const ELIGIBILITY_STATUSES = ["eligible", "not_eligible"] as const;

export interface SystemSettings {
  cutoffDate: string;
  minAgeYears: number;
  minAgeMonths: number;
  whatsappGroupUrl: string;
  openingCountdownEnabled: boolean;
  openingDateTime: string;
}

export function openingTimestamp(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!isValidIsoDate(`${yearText}-${monthText}-${dayText}`) || hour > 23 || minute > 59) return null;
  return Date.UTC(year, month - 1, day, hour - 7, minute);
}

export function isRegistrationOpen(settings: SystemSettings, now = new Date()): boolean {
  if (!settings.openingCountdownEnabled) return true;
  const timestamp = openingTimestamp(settings.openingDateTime);
  return timestamp !== null && now.getTime() >= timestamp;
}

export interface WaitinglistRecordInput {
  nama_ortu: string;
  status_ortu: "bapak" | "ibu";
  nama_anak: string;
  jenis_kelamin: "putra" | "putri";
  sekolah_asal: string | null;
  tanggal_lahir_anak: string;
  umur_terhitung_bulan: number;
  status_eligibility: "eligible";
  provinsi_id: string;
  provinsi_nama: string;
  kabupaten_id: string;
  kabupaten_nama: string;
  kecamatan_id: string;
  kecamatan_nama: string;
  desa_id: string;
  desa_nama: string;
  no_hp_wa: string;
  email: string;
  konfirmasi_data: number;
  konfirmasi_bukti_transfer: number;
  konfirmasi_ketentuan_biaya: number;
  created_at: string;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function subtractMonths(value: string, months: number): string {
  if (!isValidIsoDate(value)) throw new Error("Tanggal acuan tidak valid.");
  const [year, month, day] = value.split("-").map(Number);
  const monthIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = monthIndex - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function eligibleBirthdate(settings: SystemSettings): string {
  return subtractMonths(settings.cutoffDate, settings.minAgeYears * 12 + settings.minAgeMonths);
}

export function addCalendarYears(value: string, years: number): string {
  if (!isValidIsoDate(value) || !Number.isInteger(years)) throw new Error("Tanggal tahun tidak valid.");
  const [year, month, day] = value.split("-").map(Number);
  const targetYear = year + years;
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(month).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function completedAgeMonths(birthdate: string, referenceDate: string): number {
  const [birthYear, birthMonth, birthDay] = birthdate.split("-").map(Number);
  const [referenceYear, referenceMonth, referenceDay] = referenceDate.split("-").map(Number);
  let months = (referenceYear - birthYear) * 12 + referenceMonth - birthMonth;
  if (referenceDay < birthDay) months -= 1;
  return Math.max(months, 0);
}

export function nextEligibleCohort(
  birthdate: string,
  settings: SystemSettings,
): { cutoffDate: string; year: number; yearsAway: number } | null {
  if (!isValidIsoDate(birthdate) || !isValidIsoDate(settings.cutoffDate)) return null;
  const requiredMonths = settings.minAgeYears * 12 + settings.minAgeMonths;
  for (let yearsAway = 1; yearsAway <= 100; yearsAway += 1) {
    const cutoffDate = addCalendarYears(settings.cutoffDate, yearsAway);
    if (completedAgeMonths(birthdate, cutoffDate) >= requiredMonths) {
      return { cutoffDate, year: Number(cutoffDate.slice(0, 4)), yearsAway };
    }
  }
  return null;
}

export function eligibilityRetryMessage(birthdate: string, settings: SystemSettings): string {
  const cohort = nextEligibleCohort(birthdate, settings);
  if (!cohort) return "Umur Ananda belum memenuhi batas usia. Silakan hubungi panitia untuk informasi pendaftaran berikutnya.";
  const currentYear = settings.cutoffDate.slice(0, 4);
  return `Mohon maaf umur Ananda belum masuk kriteria SPSB ${currentYear}. Ananda dapat mendaftar kembali pada SPSB ${cohort.year}, sekitar ${cohort.yearsAway} tahun lagi.`;
}

export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[^0-9+]/g, "");
  if (!cleaned) throw new Error("Nomor WhatsApp wajib diisi.");
  if (cleaned.includes("+") && !cleaned.startsWith("+62")) {
    throw new Error("Format nomor tidak dikenali. Gunakan awalan 0, 62, atau +62.");
  }

  let normalized: string;
  if (cleaned.startsWith("+62")) normalized = cleaned.slice(1);
  else if (cleaned.startsWith("0")) normalized = `62${cleaned.slice(1)}`;
  else if (cleaned.startsWith("62")) normalized = cleaned;
  else throw new Error("Format nomor tidak dikenali. Gunakan awalan 0, 62, atau +62.");

  if (!/^628\d{8,12}$/.test(normalized) || normalized.length < 11 || normalized.length > 15) {
    throw new Error("Nomor WhatsApp tidak valid. Pastikan nomor aktif dan diawali 08 atau 628.");
  }
  return normalized;
}

function requiredText(payload: Record<string, unknown>, key: string, label: string, maxLength: number): string {
  const value = String(payload[key] ?? "").trim();
  if (!value) throw new Error(`${label} wajib diisi.`);
  if (value.length > maxLength) throw new Error(`${label} terlalu panjang.`);
  return value;
}

export function validateWaitinglist(
  payload: Record<string, unknown>,
  settings: SystemSettings,
  now = new Date(),
): WaitinglistRecordInput {
  const nama_ortu = requiredText(payload, "nama_ortu", "Nama orang tua", 120);
  const status_ortu = String(payload.status_ortu ?? "").trim().toLowerCase();
  if (status_ortu !== "bapak" && status_ortu !== "ibu") {
    throw new Error("Pilih status Bapak atau Ibu.");
  }

  const nama_anak = requiredText(payload, "nama_anak", "Nama anak", 120);
  const jenis_kelamin = String(payload.jenis_kelamin ?? "").trim().toLowerCase();
  if (jenis_kelamin !== "putra" && jenis_kelamin !== "putri") {
    throw new Error("Pilih jenis kelamin Putra atau Putri.");
  }
  const sekolah_asal = String(payload.sekolah_asal ?? "").trim();
  if (sekolah_asal.length > 120) throw new Error("Sekolah asal terlalu panjang.");
  const tanggal_lahir_anak = String(payload.tanggal_lahir_anak ?? "").trim();
  if (!isValidIsoDate(tanggal_lahir_anak)) throw new Error("Tanggal lahir tidak valid.");
  if (tanggal_lahir_anak > now.toISOString().slice(0, 10)) {
    throw new Error("Tanggal lahir tidak boleh di masa depan.");
  }
  if (tanggal_lahir_anak > eligibleBirthdate(settings)) {
    throw new Error(eligibilityRetryMessage(tanggal_lahir_anak, settings));
  }

  const region: Record<string, string> = {};
  const regionFields: Array<[string, string, RegExp]> = [
    ["provinsi", "Provinsi", /^\d{2}$/],
    ["kabupaten", "Kabupaten/Kota", /^\d{2}\.\d{2}$/],
    ["kecamatan", "Kecamatan", /^\d{2}\.\d{2}\.\d{2}$/],
    ["desa", "Desa/Kelurahan", /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/],
  ];
  for (const [key, label, idPattern] of regionFields) {
    const id = String(payload[`${key}_id`] ?? "").trim();
    const name = String(payload[`${key}_nama`] ?? "").trim();
    if (!idPattern.test(id) || !name || name.length > 120) {
      throw new Error(`Pilih ${label} dari daftar.`);
    }
    region[`${key}_id`] = id;
    region[`${key}_nama`] = name;
  }

  const email = requiredText(payload, "email", "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Format email belum valid.");
  if (![true, "true", "on", 1].includes(payload.konfirmasi_data as true | "true" | "on" | 1)) {
    throw new Error("Centang konfirmasi bahwa data sudah benar dan lengkap.");
  }
  if (![true, "true", "on", 1].includes(payload.konfirmasi_bukti_transfer as true | "true" | "on" | 1)) {
    throw new Error("Centang konfirmasi bahwa bukti transfer biaya pendaftaran sudah dikirim.");
  }
  if (![true, "true", "on", 1].includes(payload.konfirmasi_ketentuan_biaya as true | "true" | "on" | 1)) {
    throw new Error("Setujui ketentuan biaya pendaftaran sebelum melanjutkan.");
  }

  return {
    nama_ortu,
    status_ortu,
    nama_anak,
    jenis_kelamin,
    sekolah_asal: sekolah_asal || null,
    tanggal_lahir_anak,
    umur_terhitung_bulan: completedAgeMonths(tanggal_lahir_anak, settings.cutoffDate),
    status_eligibility: "eligible",
    ...region,
    no_hp_wa: normalizePhone(String(payload.no_hp_wa ?? "")),
    email,
    konfirmasi_data: 1,
    konfirmasi_bukti_transfer: 1,
    konfirmasi_ketentuan_biaya: 1,
    created_at: now.toISOString(),
  } as WaitinglistRecordInput;
}

export function validateSettings(input: unknown): SystemSettings {
  if (!input || typeof input !== "object") throw new Error("Pengaturan tidak valid.");
  const value = input as Record<string, unknown>;
  const cutoffDate = String(value.cutoffDate ?? "").trim();
  const minAgeYears = Number(value.minAgeYears);
  const minAgeMonths = Number(value.minAgeMonths);
  const whatsappGroupUrl = String(value.whatsappGroupUrl ?? "").trim();
  const openingCountdownEnabled = value.openingCountdownEnabled === true;
  const openingDateTime = String(value.openingDateTime ?? "").trim();

  if (!isValidIsoDate(cutoffDate)) throw new Error("Tanggal acuan tidak valid.");
  if (!Number.isInteger(minAgeYears) || minAgeYears < 0 || minAgeYears > 18) {
    throw new Error("Usia minimum tahun harus di antara 0 dan 18.");
  }
  if (!Number.isInteger(minAgeMonths) || minAgeMonths < 0 || minAgeMonths > 11) {
    throw new Error("Usia minimum bulan harus di antara 0 dan 11.");
  }
  if (minAgeYears === 0 && minAgeMonths === 0) throw new Error("Usia minimum tidak boleh nol.");
  if (openingCountdownEnabled && openingTimestamp(openingDateTime) === null) {
    throw new Error("Tanggal dan jam pembukaan WIB wajib diisi dengan format yang valid.");
  }
  if (openingDateTime && openingTimestamp(openingDateTime) === null) {
    throw new Error("Tanggal dan jam pembukaan WIB tidak valid.");
  }
  if (whatsappGroupUrl) {
    try {
      const parsed = new URL(whatsappGroupUrl);
      if (parsed.protocol !== "https:" || !["chat.whatsapp.com", "wa.me", "www.whatsapp.com", "whatsapp.com"].includes(parsed.hostname)) {
        throw new Error();
      }
    } catch {
      throw new Error("Tautan grup harus berupa URL HTTPS WhatsApp yang valid.");
    }
  }

  return { cutoffDate, minAgeYears, minAgeMonths, whatsappGroupUrl, openingCountdownEnabled, openingDateTime };
}

export function csvSafe(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}
