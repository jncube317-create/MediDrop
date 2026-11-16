// All money is integer cents. Never floats.

export function assertCents(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of cents, got ${value}`);
  }
}

export function formatUsd(cents: number): string {
  assertCents(cents, "amount");
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  return `$${dollars}.${rest.toString().padStart(2, "0")}`;
}

export interface OrderTotals {
  medicineCents: number;
  deliveryCents: number;
  totalCents: number;
}

export function orderTotals(unitCents: number, qty: number, deliveryCents: number): OrderTotals {
  assertCents(unitCents, "unit price");
  assertCents(deliveryCents, "delivery fee");
  if (!Number.isInteger(qty) || qty < 1) {
    throw new Error(`quantity must be a whole number of at least 1, got ${qty}`);
  }
  const medicineCents = unitCents * qty;
  return { medicineCents, deliveryCents, totalCents: medicineCents + deliveryCents };
}

/** Paynow's SDK takes a decimal dollar amount. Convert at the very edge only. */
export function centsToPaynowAmount(cents: number): number {
  assertCents(cents, "amount");
  return Number((cents / 100).toFixed(2));
}
