import { randomBytes, randomInt } from "node:crypto";
import type { CartLine } from "./cart";
import { lineTotal } from "./cart";

export type OrderStatus =
  | "DRAFT"
  | "AWAITING_PAYMENT"
  | "PAYMENT_FAILED"
  | "PAID" // being packed
  | "READY" // packed, waiting at the pickup counter
  | "COLLECTED"
  | "CANCELLED"
  | "ISSUE";

// Only these moves are allowed. Everything else is refused.
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  PAID: ["READY", "ISSUE"],
  READY: ["COLLECTED", "ISSUE"],
  COLLECTED: [],
  CANCELLED: [],
  ISSUE: [],
};

export const TERMINAL: readonly OrderStatus[] = ["COLLECTED", "CANCELLED", "ISSUE"];

export interface OrderEvent {
  at: string;
  by: string;
  from: OrderStatus;
  to: OrderStatus;
}

export interface OrderLine extends CartLine {
  missing: boolean; // staff found it out of stock while packing
}

export interface Order {
  id: string;
  customer: string;
  customerName: string;
  lines: OrderLine[];
  slot: { id: string; label: string; startsAt: number; endsAt: number };
  totalCents: number; // goods total when ordered
  walletCents: number; // paid from the Greens wallet
  payCents: number; // paid by EcoCash / OneMoney
  refundedCents: number; // credited back to the wallet for missing items
  status: OrderStatus;
  pickupCode: string; // 6 digits, shown on the receipt
  qrToken: string; // random, used in the receipt QR image link
  arrived: boolean; // customer tapped "I'm here"
  payment: { reference: string; pollUrl: string | null; simulated: boolean; startedAt: number } | null;
  paymentAttempts: number;
  events: OrderEvent[];
  createdAt: number;
  collectedAt: number | null;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Moves the order to a new state. Returns false (and changes nothing) if the move isn't allowed. */
export function transition(order: Order, to: OrderStatus, by: string): boolean {
  if (!canTransition(order.status, to)) return false;
  order.events.push({ at: new Date().toISOString(), by, from: order.status, to });
  order.status = to;
  return true;
}

/** A 6-digit code that no active order is using. */
export function newPickupCode(inUse: Set<string>): string {
  for (let i = 0; i < 1000; i++) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    if (!inUse.has(code)) return code;
  }
  throw new Error("Couldn't find a free pickup code");
}

export function newQrToken(): string {
  return randomBytes(16).toString("hex");
}

export type MissingResult =
  | { ok: true; refundCents: number; allMissing: boolean }
  | { ok: false; reason: "not_packing" | "not_in_order" | "already_missing" };

/**
 * Staff mark a line as out of stock while packing. Its full value goes back
 * to the customer's wallet. Only allowed while the order is being packed.
 */
export function markMissing(order: Order, productId: string): MissingResult {
  if (order.status !== "PAID") return { ok: false, reason: "not_packing" };
  const line = order.lines.find((l) => l.productId === productId);
  if (!line) return { ok: false, reason: "not_in_order" };
  if (line.missing) return { ok: false, reason: "already_missing" };
  line.missing = true;
  const refundCents = lineTotal(line);
  order.refundedCents += refundCents;
  return { ok: true, refundCents, allMissing: order.lines.every((l) => l.missing) };
}

export type PickupCheck =
  | { result: "ok"; order: Order }
  | { result: "not_found" }
  | { result: "still_packing"; order: Order }
  | { result: "already_collected"; order: Order };

/** What happens when staff type a code at the counter. Doesn't change anything. */
export function checkPickupCode(orders: Iterable<Order>, input: string): PickupCheck {
  const code = input.replace(/\D/g, "");
  if (code.length !== 6) return { result: "not_found" };
  let collected: Order | undefined;
  for (const order of orders) {
    if (order.pickupCode !== code) continue;
    if (order.status === "READY") return { result: "ok", order };
    if (order.status === "PAID") return { result: "still_packing", order };
    if (order.status === "COLLECTED") collected = order;
  }
  return collected ? { result: "already_collected", order: collected } : { result: "not_found" };
}

export function statusLabel(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    DRAFT: "Not finished",
    AWAITING_PAYMENT: "Waiting for payment",
    PAYMENT_FAILED: "Payment didn't go through",
    PAID: "Paid, being packed",
    READY: "Packed, ready for pickup",
    COLLECTED: "Collected",
    CANCELLED: "Cancelled",
    ISSUE: "Our team is looking into it",
  };
  return labels[status];
}
