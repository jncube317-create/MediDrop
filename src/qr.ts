// Receipt QR code as a PNG. The QR holds only the order number and pickup code,
// so the v1 counter tablet can scan it instead of typing the code.

import QRCode from "qrcode";

export function qrText(orderId: string, pickupCode: string): string {
  return `GREENS:${orderId}:${pickupCode}`;
}

export async function qrPng(orderId: string, pickupCode: string): Promise<Buffer> {
  return QRCode.toBuffer(qrText(orderId, pickupCode), { type: "png", width: 600, margin: 3, errorCorrectionLevel: "M" });
}
