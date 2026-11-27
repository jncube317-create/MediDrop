// Specials (sponsored placements) and impulse-buy nudges. Pure functions, fully tested.
// DEMO values: in a real rollout Greens (or the paying brand) sets these.

import type { CartLine } from "./cart";
import { getProduct, type Product } from "./data";

export interface Special {
  productId: string;
  priceCents: number; // special price
  wasCents: number; // normal price, shown struck through
  featured: boolean; // shown as the sponsored card when the menu opens
}

export const SPECIALS: Special[] = [
  { productId: "g04", priceCents: 350, wasCents: 400, featured: true }, // Mazoe Orange Crush 2L
  { productId: "g07", priceCents: 360, wasCents: 400, featured: false }, // OMO Auto Liquid 750ml
];

// "Goes well with": shown once per order, after the first item that has a pairing.
export const PAIRINGS: Record<string, string> = {
  g01: "g04", // bread → Mazoe
  g04: "g01", // Mazoe → bread
  g03: "g05", // noodles → chocolate
  g07: "g06", // OMO → Sta-soft
  g06: "g07", // Sta-soft → OMO
  g02: "g01", // potatoes → bread
};

// The "till-side" items offered once at checkout, first one not already in the cart.
export const CHECKOUT_NUDGES: string[] = ["g05", "g03"];

export function specialFor(productId: string): Special | undefined {
  return SPECIALS.find((s) => s.productId === productId);
}

/** The product as it should be sold right now: special price applied. */
export function withSpecialPrice(product: Product): Product {
  const special = specialFor(product.id);
  return special ? { ...product, priceCents: special.priceCents } : product;
}

export function featuredSpecial(): Special | undefined {
  return SPECIALS.find((s) => s.featured && getProduct(s.productId)?.inStock);
}

export function specialProducts(): Product[] {
  return SPECIALS.flatMap((s) => {
    const p = getProduct(s.productId);
    return p && p.inStock ? [withSpecialPrice(p)] : [];
  });
}

const inCart = (cart: CartLine[], id: string) => cart.some((l) => l.productId === id);

/** A product to suggest after this one was added, or nothing. */
export function pairingFor(addedId: string, cart: CartLine[]): Product | undefined {
  const id = PAIRINGS[addedId];
  if (!id || inCart(cart, id)) return undefined;
  const p = getProduct(id);
  return p && p.inStock ? withSpecialPrice(p) : undefined;
}

/** The impulse item to offer before paying, or nothing if the cart already has them all. */
export function checkoutNudgeFor(cart: CartLine[]): Product | undefined {
  for (const id of CHECKOUT_NUDGES) {
    if (inCart(cart, id)) continue;
    const p = getProduct(id);
    if (p && p.inStock) return withSpecialPrice(p);
  }
  return undefined;
}
