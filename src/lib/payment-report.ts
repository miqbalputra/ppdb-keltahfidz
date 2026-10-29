import type { EncryptedWaitinglistFilterRow, WaitinglistFilterQuery } from "./waitinglist-filters";

export const REGISTRATION_FEE = 150_000;
export function trendIntervalLabel(interval: string) {
  return ({ daily: 'harian', weekly: 'mingguan', monthly: 'bulanan', yearly: 'tahunan' } as Record<string, string>)[interval]
    || interval.replace(/^(\d+)-year$/, 'per $1 tahun');
}
export function paymentLabel(status?: string | null) {
  return status === "verified" ? "Terverifikasi" : status === "needs_correction" ? "Perlu perbaikan" : "Belum diperiksa";
}
export function buildPaymentReport(rows: EncryptedWaitinglistFilterRow[], query: WaitinglistFilterQuery, now = new Date()) {
  const counts = { pending: 0, verified: 0, needs_correction: 0 };
  let withoutProof = 0;
  const date = (time: number) => new Date(time).toISOString().slice(0, 10);
  const end = query.tanggal_bayar_sampai || date(now.getTime() + 7 * 3600000);
  const start = query.tanggal_bayar_mulai || date(Date.parse(end) - 29 * 86400000);
  const span = Math.max(0, (Date.parse(end) - Date.parse(start)) / 86400000);
  const interval = span > 366 * 30 ? "yearly" : span > 366 ? "monthly" : span > 90 ? "weekly" : "daily";
  const yearStep = Math.max(1, Math.ceil((Number(end.slice(0, 4)) - Number(start.slice(0, 4)) + 1) / 360));
  const bucket = (value: string) => interval === "yearly" ? `${String(Math.floor(Number(value.slice(0, 4)) / yearStep) * yearStep).padStart(4, "0")}-01-01`
    : interval === "monthly" ? `${value.slice(0, 7)}-01` : interval === "weekly"
      ? date(Date.parse(value) - ((new Date(value).getUTCDay() + 6) % 7) * 86400000) : value;
  const totals = new Map<string, number>();
  for (const row of rows) {
    const status = row.payment_status === "verified" || row.payment_status === "needs_correction" ? row.payment_status : "pending";
    counts[status]++;
    if (!row.bukti_transfer_mime) withoutProof++;
    if (status === "verified" && row.payment_date && row.payment_date >= start && row.payment_date <= end) {
      const key = bucket(row.payment_date); totals.set(key, (totals.get(key) || 0) + 1);
    }
  }
  const buckets: Array<{ date: string; total: number; amount: number }> = [];
  for (let value = bucket(start); value <= end && buckets.length < 400;) {
    const total = totals.get(value) || 0; buckets.push({ date: value, total, amount: total * REGISTRATION_FEE });
    value = interval === "yearly" ? `${String(Number(value.slice(0, 4)) + yearStep).padStart(4, "0")}-01-01`
      : interval === "monthly" ? new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 1)).toISOString().slice(0, 10)
      : date(Date.parse(value) + (interval === "weekly" ? 7 : 1) * 86400000);
  }
  return { ...counts, withoutProof, fee: REGISTRATION_FEE, verifiedAmount: counts.verified * REGISTRATION_FEE,
    verifiedPercent: rows.length ? Math.round(counts.verified / rows.length * 1000) / 10 : 0,
    trend: { start, end, interval, buckets } };
}
