// Shop price comparison: Scoutly keeps ONE product list (with its own photo per product) and
// approved shops only send prices. Pure functions here; the WhatsApp side lives in bot.ts.

import { guessCategory, wordsClose } from "./parse";

export interface ShopPrice {
  cents: number;
  at: number; // when the shop last sent this price
}

export interface Product {
  id: string; // PR-001
  name: string; // "Olivine cooking oil 2L", "Brake pads front · Toyota Hilux 2005-2015"
  category: string; // "groceries" or "carparts" (any category key works)
  photo: string | null; // Scoutly's own photo
  prices: Record<string, ShopPrice>; // shop phone → price
  createdAt: number;
}

export const STALE_DAYS = 14; // shown with a ⚠️
export const HIDE_DAYS = 30; // not shown at all
const DAY = 24 * 3600_000;

const SIZE = /^\d+(\.\d+)?(ml|l|lt|ltr|litre|litres|kg|g|gram|grams|pack|pk|x\d+)?$/;

/** Words and sizes of a product name: "Olivine Cooking Oil 2 L" → ["olivine","cooking","oil","2l"]. */
export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/(\d)\s+(ml|l|lt|ltr|litres?|kg|g|grams?)\b/g, "$1$2") // "2 L" → "2l"
    .replace(/\b(\d+)\s*(litres?|ltr|lt)\b/g, "$1l")
    .replace(/[^a-z0-9. ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 || /\d/.test(w))
    .filter((w) => !["the", "and", "for", "of", "a", "an", "with", "pack"].includes(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !SIZE.test(w) ? w.slice(0, -1) : w));
}

/**
 * How well a typed name matches a product (0 to 1). Sizes must match exactly (2L is not 5L);
 * other words may have small typos ("olivne" = "olivine").
 */
export function matchScore(typed: string, product: Product): number {
  const want = tokens(product.name);
  const got = tokens(typed);
  if (!want.length || !got.length) return 0;
  const sizes = want.filter((w) => /\d/.test(w));
  if (sizes.some((s) => !got.includes(s))) return 0;
  const gotSizes = got.filter((w) => /\d/.test(w));
  if (gotSizes.some((s) => !want.includes(s))) return 0;
  let hit = 0;
  for (const w of want) if (got.some((g) => wordsClose(g, w))) hit += 1;
  const extra = got.filter((g) => !want.some((w) => wordsClose(g, w))).length;
  return hit / want.length - Math.min(extra * 0.05, 0.2);
}

/** Best product for a typed name, if it's a confident match. */
export function bestProduct(typed: string, products: Iterable<Product>, min = 0.6): Product | null {
  let best: Product | null = null;
  let score = min;
  for (const p of products) {
    const s = matchScore(typed, p);
    if (s >= score) {
      best = p;
      score = s;
    }
  }
  return best;
}

/** Products a shopper's search is about ("cooking oil" → every cooking oil), best first. */
export function searchProducts(query: string, products: Iterable<Product>, max = 9): Product[] {
  const q = tokens(query).filter((w) => !["looking", "need", "want", "cheapest", "price", "prices", "buy", "where", "budget", "under"].includes(w));
  if (!q.length) return [];
  const scored: { p: Product; s: number }[] = [];
  for (const p of products) {
    const name = tokens(p.name);
    const words = q.filter((w) => !/\d/.test(w));
    const sizes = q.filter((w) => /\d/.test(w) && !/^\d+$/.test(w));
    if (sizes.some((s) => !name.includes(s))) continue;
    const hit = words.filter((w) => name.some((n) => wordsClose(w, n))).length;
    if (!words.length || hit / words.length < 0.6) continue;
    scored.push({ p, s: hit / words.length + (sizes.length ? 0.2 : 0) });
  }
  return scored.sort((a, b) => b.s - a.s || cheapest(a.p) - cheapest(b.p)).slice(0, max).map((x) => x.p);
}

/** Current (not hidden) shop prices for a product, cheapest first. */
export function livePrices(p: Product, now = Date.now()): { shop: string; cents: number; at: number; stale: boolean }[] {
  return Object.entries(p.prices)
    .filter(([, v]) => now - v.at <= HIDE_DAYS * DAY)
    .map(([shop, v]) => ({ shop, cents: v.cents, at: v.at, stale: now - v.at > STALE_DAYS * DAY }))
    .sort((a, b) => a.cents - b.cents || b.at - a.at);
}

function cheapest(p: Product): number {
  return livePrices(p)[0]?.cents ?? Number.MAX_SAFE_INTEGER;
}

export function ageLabel(at: number, now = Date.now()): string {
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated yesterday";
  return `updated ${days} days ago`;
}

/** "Olivine cooking oil 2L 3.80" or "Olivine cooking oil 2L - $3.80" → name + cents. */
export function parsePriceLine(line: string): { name: string; cents: number } | null {
  const m = line.trim().match(/^(.*?)[\s,:;=\-–@]+(?:us)?\$?\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*(?:usd|\$)?\s*$/i);
  if (!m?.[1] || !m[2]) return null;
  const name = m[1].trim().replace(/[\s,:;=\-–@]+$/, "");
  const cents = Math.round(Number(m[2].replace(",", ".")) * 100);
  if (!name || !Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) return null;
  return { name, cents };
}

export interface PriceUpdate {
  updated: { product: Product; cents: number }[];
  unknown: string[]; // lines we couldn't match to a product
  unknownRows: { name: string; cents: number }[]; // the same lines, kept so they go live when the product is added
  needsSize: { line: string; example: string }[]; // product found but the shop left out the size
  unreadable: string[]; // lines with no price
}

/** Applies a shop's price list (typed lines or spreadsheet rows) to the product list. */
export function applyPrices(shop: string, rows: { name: string; cents: number }[], products: Iterable<Product>, now = Date.now()): PriceUpdate {
  const list = [...products];
  const out: PriceUpdate = { updated: [], unknown: [], unknownRows: [], needsSize: [], unreadable: [] };
  for (const r of rows) {
    const p = bestProduct(r.name, list);
    const sized = p ? null : sizeHint(r.name, list);
    if (sized) {
      out.needsSize.push({ line: r.name, example: `${sized.name} ${(r.cents / 100).toFixed(2)}` });
      continue;
    }
    if (!p) {
      out.unknownRows.push(r);
      out.unknown.push(`${r.name} ${(r.cents / 100).toFixed(2)}`);
      continue;
    }
    p.prices[shop] = { cents: r.cents, at: now };
    out.updated.push({ product: p, cents: r.cents });
  }
  return out;
}

/** Shop typed no size ("Olivine cooking oil") but a sized product matches the words: suggest it. */
export function sizeHint(typed: string, products: Iterable<Product>): Product | null {
  const got = tokens(typed);
  if (got.some((w) => /\d/.test(w))) return null;
  for (const p of products) {
    const want = tokens(p.name);
    const words = want.filter((w) => !/\d/.test(w));
    if (words.length === want.length || !words.length) continue;
    const hit = words.filter((w) => got.some((g) => wordsClose(g, w))).length;
    if (hit / words.length >= 0.75 && got.every((g) => words.some((w) => wordsClose(g, w)))) return p;
  }
  return null;
}

/** Product names: no brackets or stray symbols (people copy "ADD <name>" literally). */
export function cleanProductName(name: string): string {
  return name.replace(/[<>\[\]{}"*_]/g, " ").replace(/\s+/g, " ").trim();
}

/** Category for a new product: "groceries" unless the name clearly says car parts etc. */
export function productCategory(name: string, explicit?: string): string {
  if (explicit) return explicit;
  const g = guessCategory(name);
  return g === "carparts" || g === "cars" ? "carparts" : g && g !== "other" ? g : "groceries";
}

/** Marketplace paging: which slice of `total` listings page `page` shows, how many are left, and the next page number. */
export function marketPage(total: number, page: number, size: number): { start: number; end: number; left: number; next: number | null } {
  const last = Math.max(0, Math.floor((total - 1) / size));
  const p = Math.min(Math.max(0, Math.floor(page) || 0), last);
  const start = p * size;
  const end = Math.min(total, start + size);
  const left = total - end;
  return { start, end, left, next: left > 0 ? p + 1 : null };
}
