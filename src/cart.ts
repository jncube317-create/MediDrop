// The customer's basket. Pure functions, no WhatsApp, fully tested.

import { assertCents, formatUsd } from "./money";
import type { Product } from "./data";

export interface CartLine {
  productId: string;
  name: string;
  qty: number;
  unitCents: number; // copied when added; later price edits don't change it
}

export type AddResult = { ok: true; line: CartLine } | { ok: false; reason: "out_of_stock" | "max_qty" };

export const MAX_CART_LINES = 30;

/** Adds qty of a product. Refuses out-of-stock items and anything over the per-order limit. */
export function addToCart(cart: CartLine[], product: Product, qty = 1): AddResult {
  if (!Number.isInteger(qty) || qty < 1) throw new Error(`quantity must be a whole number of at least 1, got ${qty}`);
  assertCents(product.priceCents, "price");
  if (!product.inStock) return { ok: false, reason: "out_of_stock" };
  const existing = cart.find((l) => l.productId === product.id);
  const current = existing?.qty ?? 0;
  if (current + qty > product.maxQty) return { ok: false, reason: "max_qty" };
  if (existing) {
    existing.qty += qty;
    return { ok: true, line: existing };
  }
  if (cart.length >= MAX_CART_LINES) return { ok: false, reason: "max_qty" };
  const line: CartLine = { productId: product.id, name: product.name, qty, unitCents: product.priceCents };
  cart.push(line);
  return { ok: true, line };
}

/** Takes one off a line; removes the line when it reaches zero. Returns false if it wasn't in the cart. */
export function removeOne(cart: CartLine[], productId: string): boolean {
  const index = cart.findIndex((l) => l.productId === productId);
  const line = cart[index];
  if (!line) return false;
  line.qty -= 1;
  if (line.qty <= 0) cart.splice(index, 1);
  return true;
}

export function lineTotal(line: CartLine): number {
  return line.unitCents * line.qty;
}

export function cartTotal(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + lineTotal(l), 0);
}

export function itemCount(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + l.qty, 0);
}

/** "2 × Cooking oil 2L  $8.40" lines for messages and receipts. */
export function cartLines(cart: CartLine[]): string {
  return cart.map((l) => `${l.qty} × ${l.name}  ${formatUsd(lineTotal(l))}`).join("\n");
}
