import { expect, test } from "bun:test";
import { buildPaymentReport } from "../src/lib/payment-report";
import type { EncryptedWaitinglistFilterRow } from "../src/lib/waitinglist-filters";

test("financial totals only count verified payments and never treat an upload as verification", () => {
  const rows = [
    { payment_status: "pending", bukti_transfer_mime: "image/png" },
    { payment_status: "needs_correction", bukti_transfer_mime: "application/pdf" },
    { payment_status: "verified", payment_date: "2026-10-29", bukti_transfer_mime: "image/jpeg" },
    { payment_status: "pending", bukti_transfer_mime: null },
  ] as EncryptedWaitinglistFilterRow[];
  const report = buildPaymentReport(rows, {}, new Date("2026-10-28T17:00:00Z"));
  expect(report).toMatchObject({ pending: 2, needs_correction: 1, verified: 1, verifiedAmount: 150000, verifiedPercent: 25, withoutProof: 1 });
  expect(report.trend.end).toBe("2026-10-29");
  expect(report.trend.buckets.at(-1)).toEqual({ date: "2026-10-29", total: 1, amount: 150000 });
});
test("empty financial reports are numeric and long periods preserve all payments", () => {
  const empty = buildPaymentReport([], {}, new Date("2026-10-29T00:00:00Z"));
  expect(empty.verifiedPercent).toBe(0); expect(empty.trend.buckets).toHaveLength(30);
  const report = buildPaymentReport([{ payment_status: "verified", payment_date: "1900-01-01" }, { payment_status: "verified", payment_date: "2026-10-29" }] as EncryptedWaitinglistFilterRow[], { tanggal_bayar_mulai: "1900-01-01", tanggal_bayar_sampai: "2026-10-29" });
  expect(report.trend.buckets.length).toBeLessThanOrEqual(400);
  expect(report.trend.buckets.reduce((sum, row) => sum + row.amount, 0)).toBe(300000);
});
