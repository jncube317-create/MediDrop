// Demo catalogue: Zolile's 8 product photos.
// Prices are SAMPLE prices in US cents, checked against Zimbabwe news reports and
// South African shelf prices (Nov 2026). In v1 these come from Greens' till system (POS).

export type CategoryKey = "fresh" | "cupboard" | "household";

export interface Category {
  key: CategoryKey;
  name: string; // max 24 chars (list row title)
  blurb: string; // max 72 chars (list row description)
}

export const CATEGORIES: Category[] = [
  { key: "fresh", name: "Bakery & fresh", blurb: "Bread, potatoes" },
  { key: "cupboard", name: "Food, drinks & snacks", blurb: "Noodles, Mazoe, chocolate" },
  { key: "household", name: "Household & care", blurb: "Fabric softener, washing liquid, roll-on" },
];

export interface Product {
  id: string; // also the picture name: public/img/<id>.jpg
  name: string; // max 24 chars
  size: string;
  category: CategoryKey;
  priceCents: number;
  inStock: boolean;
  maxQty: number; // per order
  blurb: string; // short description on the product card
  aliases: string[];
}

export const PRODUCTS: Product[] = [
  { id: "g01", name: "Proton White Loaf", size: "Standard loaf", category: "fresh", priceCents: 110, inStock: true, maxQty: 6, blurb: "Soft, fresh sliced white bread from Proton, baking since 1961. Perfect for breakfast and school lunches.", aliases: ["bread", "loaf", "proton", "white bread"] },
  { id: "g02", name: "Potatoes 10kg pocket", size: "10kg pocket", category: "fresh", priceCents: 700, inStock: true, maxQty: 3, blurb: "A full 10kg pocket of firm, fresh potatoes. Enough for chips, stews and roasts all week.", aliases: ["potato", "potatoes", "pocket", "amazambane", "mbatatisi"] },
  { id: "g03", name: "Kellogg's Noodles Curry", size: "70g · Durban curry", category: "cupboard", priceCents: 50, inStock: true, maxQty: 20, blurb: "Ready in minutes: instant noodles with a spicy Durban curry flavour. A quick lunch or late-night snack.", aliases: ["noodles", "kelloggs", "kellogg", "instant noodles", "curry noodles"] },
  { id: "g04", name: "Mazoe Orange Crush 2L", size: "2 litres", category: "cupboard", priceCents: 400, inStock: true, maxQty: 6, blurb: "Zimbabwe's favourite orange crush. Mix with cold water for a refreshing drink the whole family loves.", aliases: ["mazoe", "orange crush", "juice", "cordial", "drink"] },
  { id: "g05", name: "Dairy Milk Oreo 162g", size: "162g slab", category: "cupboard", priceCents: 350, inStock: true, maxQty: 6, blurb: "Creamy Cadbury Dairy Milk with crunchy Oreo biscuit pieces and vanilla creme. Made for sharing.", aliases: ["chocolate", "cadbury", "dairy milk", "oreo", "choc", "slab"] },
  { id: "g06", name: "Sta-soft Baby 2L", size: "2 litres", category: "household", priceCents: 450, inStock: true, maxQty: 4, blurb: "Gentle fabric softener made for baby's delicate skin. Leaves clothes soft and smelling fresh.", aliases: ["sta soft", "stasoft", "fabric softener", "softener", "conditioner"] },
  { id: "g07", name: "OMO Auto Liquid 750ml", size: "750ml · equals 2kg powder", category: "household", priceCents: 400, inStock: true, maxQty: 4, blurb: "Tough on stains in automatic machines. This 750ml bottle washes like a 2kg box of powder.", aliases: ["omo", "washing liquid", "detergent", "washing powder", "washing"] },
  { id: "g08", name: "Nivea Roll-on 50ml", size: "Fresh Flower · 50ml", category: "household", priceCents: 300, inStock: true, maxQty: 4, blurb: "Fresh Flower roll-on with up to 48-hour protection and a light floral scent.", aliases: ["nivea", "roll on", "rollon", "deodorant", "roll-on"] },
];

export function getProduct(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export function getCategory(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

export function productsIn(category: CategoryKey): Product[] {
  return PRODUCTS.filter((p) => p.category === category);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = temp;
    }
  }
  return prev[b.length] ?? 0;
}

/** Keyword + typo-tolerant search over product names and everyday/local names. */
export function findProducts(query: string): Product[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const qWords = q.split(" ");
  return PRODUCTS.filter((p) => {
    const terms = [normalize(p.name), ...p.aliases.map(normalize)];
    return terms.some((term) => {
      if (q.length >= 3 && term.includes(q)) return true;
      if (term.length >= 3 && q.includes(term)) return true;
      const termWords = term.split(" ");
      return qWords.some((qw) =>
        qw.length >= 4 &&
        termWords.some((tw) => tw.length >= 4 && levenshtein(qw, tw) <= (tw.length >= 7 ? 2 : 1)),
      );
    });
  });
}

/** Sample picture, served by this server at /img/<id>.jpg. Null when there's no public URL yet. */
export function productImageUrl(publicUrl: string, productId: string): string | null {
  return publicUrl.startsWith("https://") ? `${publicUrl}/img/${productId}.jpg` : null;
}
