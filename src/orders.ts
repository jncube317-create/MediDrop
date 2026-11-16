import { randomInt } from "node:crypto";
import type { ZoneKey } from "./data";

export type OrderStatus =
  | "DRAFT"
  | "AWAITING_PHARMACIST"
  | "QUOTED"
  | "AWAITING_PAYMENT"
  | "PAYMENT_FAILED"
  | "PAID"
  | "READY"
  | "DRIVER_ASSIGNED"
  | "COLLECTED"
  | "DELIVERED"
  | "REJECTED"
  | "CANCELLED"
  | "ISSUE";

// Only these moves are allowed. Everything else is refused.
const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  DRAFT: ["AWAITING_PHARMACIST", "AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PHARMACIST: ["QUOTED", "REJECTED", "CANCELLED"],
  QUOTED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "PAYMENT_FAILED", "CANCELLED"],
  PAYMENT_FAILED: ["AWAITING_PAYMENT", "CANCELLED"],
  PAID: ["READY", "ISSUE"],
  READY: ["DRIVER_ASSIGNED", "ISSUE"],
  DRIVER_ASSIGNED: ["COLLECTED", "ISSUE"],
  COLLECTED: ["DELIVERED", "ISSUE"],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: [],
  ISSUE: [],
};

export const PRE_PAID: readonly OrderStatus[] = [
  "DRAFT",
  "AWAITING_PHARMACIST",
  "QUOTED",
  "AWAITING_PAYMENT",
  "PAYMENT_FAILED",
];

export const TERMINAL: readonly OrderStatus[] = ["DELIVERED", "REJECTED", "CANCELLED", "ISSUE"];

export interface OrderEvent {
  at: string;
  by: string;
  from: OrderStatus;
  to: OrderStatus;
}

export interface Order {
  id: string;
  customer: string;
  customerName: string;
  medicineId: string;
  pharmacyId: string;
  qty: number;
  unitCents: number; // copied when the order is created; later price edits don't change it
  deliveryCents: number;
  zone: ZoneKey | null;
  suburb: string | null;
  address: string | null;
  needsScript: boolean;
  scriptMediaId: string | null;
  status: OrderStatus;
  deliveryCode: string;
  codeAttempts: number;
  payment: { reference: string; pollUrl: string | null; simulated: boolean; startedAt: number } | null;
  paymentAttempts: number;
  events: OrderEvent[];
  createdAt: number;
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

export function newDeliveryCode(): string {
  return randomInt(0, 10000).toString().padStart(4, "0");
}

export const MAX_CODE_ATTEMPTS = 3;

export type CodeResult = { result: "ok" } | { result: "wrong"; attemptsLeft: number } | { result: "locked" };

/** Checks the driver's code. Three wrong tries locks it. Does not change order status. */
export function checkDeliveryCode(order: Order, input: string): CodeResult {
  if (order.codeAttempts >= MAX_CODE_ATTEMPTS) return { result: "locked" };
  if (input.trim() === order.deliveryCode) return { result: "ok" };
  order.codeAttempts += 1;
  if (order.codeAttempts >= MAX_CODE_ATTEMPTS) return { result: "locked" };
  return { result: "wrong", attemptsLeft: MAX_CODE_ATTEMPTS - order.codeAttempts };
}

export function statusLabel(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    DRAFT: "Not finished",
    AWAITING_PHARMACIST: "Pharmacist is checking your script",
    QUOTED: "Approved, waiting for payment",
    AWAITING_PAYMENT: "Waiting for payment",
    PAYMENT_FAILED: "Payment didn't go through",
    PAID: "Paid, being prepared",
    READY: "Packed, finding a driver",
    DRIVER_ASSIGNED: "Driver on the way to the pharmacy",
    COLLECTED: "On the way to you",
    DELIVERED: "Delivered",
    REJECTED: "Script not approved",
    CANCELLED: "Cancelled",
    ISSUE: "Our team is looking into it",
  };
  return labels[status];
}
