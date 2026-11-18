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

export interface PaymentSplit {
  walletCents: number; // taken from the customer's Greens wallet
  payCents: number; // charged through Paynow
}

/** Uses wallet credit first, then the rest goes to EcoCash/OneMoney. */
export function splitPayment(totalCents: number, walletBalanceCents: number): PaymentSplit {
  assertCents(totalCents, "total");
  assertCents(walletBalanceCents, "wallet balance");
  const walletCents = Math.min(totalCents, walletBalanceCents);
  return { walletCents, payCents: totalCents - walletCents };
}

/** Paynow's SDK takes a decimal dollar amount. Convert at the very edge only. */
export function centsToPaynowAmount(cents: number): number {
  assertCents(cents, "amount");
  return Number((cents / 100).toFixed(2));
}
