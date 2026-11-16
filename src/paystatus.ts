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
