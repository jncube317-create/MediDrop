// Pure Paynow helpers (no network, no secrets) so they can be unit tested.

export type PaymentState = "paid" | "pending" | "failed";

// Statuses that count as money received / not coming. Confirm against Paynow docs for v1.
const PAID_STATUSES = ["paid", "awaiting delivery", "delivered"];
const FAILED_STATUSES = ["cancelled", "failed", "disputed", "refunded"];

export function classifyStatus(status: string): PaymentState {
  const s = status.trim().toLowerCase();
  if (PAID_STATUSES.includes(s)) return "paid";
  if (FAILED_STATUSES.includes(s)) return "failed";
  return "pending";
}

/** Converts 263771234567 to 0771234567 (Paynow wants the local format). */
export function toLocalNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("263")) return `0${digits.slice(3)}`;
  return digits;
}

/**
 * Cleans a typed Zimbabwe mobile number into Paynow's local format (07XXXXXXXX).
 * Accepts "0772 123 456", "+263772123456", "263772123456", "772123456".
 * Returns null if it isn't a valid Zimbabwe mobile number.
 */
export function normalizeZwMobile(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("263")) digits = digits.slice(3);
  if (digits.length === 9 && digits.startsWith("7")) digits = `0${digits}`;
  return /^07\d{8}$/.test(digits) ? digits : null;
}

/** EcoCash runs on Econet (077, 078); OneMoney on NetOne (071). */
export function networkMatches(localNumber: string, method: "ecocash" | "onemoney"): boolean {
  const prefix = localNumber.slice(0, 3);
  return method === "ecocash" ? prefix === "077" || prefix === "078" : prefix === "071";
}

/** "0772123456" → "0772 123 456" for display. */
export function formatLocalNumber(localNumber: string): string {
  return `${localNumber.slice(0, 4)} ${localNumber.slice(4, 7)} ${localNumber.slice(7)}`;
}
