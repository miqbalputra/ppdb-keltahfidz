import { expect, test } from "bun:test";
import { detectPaymentProofMime } from "../src/lib/payment-proof";

test("accepts JPG, PNG, and PDF by their signatures rather than their filenames", () => {
  expect(detectPaymentProofMime(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  expect(detectPaymentProofMime(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  expect(detectPaymentProofMime(Buffer.from("%PDF-1.7\nreceipt"))).toBe("application/pdf");
});

test("rejects files without an allowed file signature", () => {
  expect(detectPaymentProofMime(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  expect(detectPaymentProofMime(new Uint8Array())).toBeNull();
});
