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

/** Paynow's SDK takes a decimal dollar amount. Convert at the very edge only. */
export function centsToPaynowAmount(cents: number): number {
  assertCents(cents, "amount");
  return Number((cents / 100).toFixed(2));
}
