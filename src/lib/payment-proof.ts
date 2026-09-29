export type PaymentProofMime = "image/jpeg" | "image/png" | "application/pdf";

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

export function detectPaymentProofMime(data: Uint8Array): PaymentProofMime | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    return "image/png";
  }
  if (data.length >= 5 && Buffer.from(data.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}
