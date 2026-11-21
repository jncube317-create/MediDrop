// Decides who sees a post, and in what order. Pure: no WhatsApp, no state.

export interface NeedLike {
  owner: string;
  category: string;
  city: string;
  anywhere: boolean; // "anywhere in Zimbabwe"
  text: string;
  budgetCents: number | null;
  kind?: string; // "item" or "service" (lets a wrongly-categorised post still match)
}

export interface ListingLike {
  id: string;
  owner: string;
  category: string;
  city: string;
  nationwide: boolean; // seller covers all of Zimbabwe
  title: string;
  text: string;
  active: boolean;
  sold: boolean;
  priceCents: number | null;
  ratingSum: number;
  ratingCount: number;
  kind?: string;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "need", "want", "looking", "someone", "who", "can", "fix", "please", "help",
  "my", "a", "an", "to", "of", "in", "on", "at", "is", "it", "i", "me", "we", "our", "your", "you", "from",
  "this", "that", "some", "any", "new", "used", "good", "cheap", "urgent", "today", "week", "under", "around",
  "buy", "sell", "selling", "ngiyacela", "please", "pre", "loved", "preloved", "second", "hand", "secondhand",
  "budget", "sale", "price", "condition", "excellent", "brand", "working", "quality", "affordable", "nice",
  "big", "small", "usd", "dollars", "negotiable", "neg", "very", "still", "like", "have", "has", "one",
]);

/** "fridges" and "fridge" should match: drop a plural s (not "ss", e.g. "glass"). */
const stem = (w: string) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Lower-case words of 3+ letters, minus common filler words. */
export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w)).map(stem))];
}

export function averageRating(o: Pick<ListingLike, "ratingSum" | "ratingCount">): number {
  return o.ratingCount === 0 ? 0 : o.ratingSum / o.ratingCount;
}

/**
 * Can this listing be shown for this need at all? Live, not yours, reachable city, and either the same
 * category or (when someone picked the wrong category, e.g. a fridge under Furniture) the same kind
 * with a shared real keyword such as "fridge".
 */
export function eligible(need: NeedLike, l: ListingLike): boolean {
  if (!l.active || l.sold) return false;
  if (l.owner === need.owner) return false;
  if (!(need.anywhere || l.nationwide || l.city === need.city)) return false;
  if (l.category === need.category) return true;
  const sameKind = need.kind !== undefined && need.kind === l.kind;
  return sameKind && overlap(need, l) >= 1;
}

/** Shared words between the post and the listing (0-3). */
export function overlap(need: NeedLike, l: ListingLike): number {
  const words = new Set(keywords(`${l.title} ${l.text}`));
  return Math.min(keywords(need.text).filter((w) => words.has(w)).length, 3);
}

/**
 * Items for the picture cards: matching words first, then within budget, then cheapest.
 * New and pre-loved come mixed, so buyers compare prices at a glance.
 */
export function rankItems<T extends ListingLike>(need: NeedLike, listings: T[], limit: number): T[] {
  const withinBudget = (l: T) => (need.budgetCents === null || l.priceCents === null ? 1 : l.priceCents <= need.budgetCents * 1.2 ? 1 : 0);
  return listings
    .filter((l) => eligible(need, l))
    .map((l) => ({ l, words: overlap(need, l), budget: withinBudget(l) }))
    .sort((a, b) => b.words - a.words || b.budget - a.budget || (a.l.priceCents ?? Infinity) - (b.l.priceCents ?? Infinity))
    .slice(0, limit)
    .map((x) => x.l);
}

/** Service providers who get the lead: same city first, matching words, then better ratings. */
export function rankProviders<T extends ListingLike>(need: NeedLike, listings: T[], skip: Set<string>, limit: number): T[] {
  return listings
    .filter((l) => !skip.has(l.id) && eligible(need, l))
    .map((l) => ({ l, s: (l.city === need.city ? 10 : 0) + overlap(need, l) + averageRating(l) / 5 }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.l);
}

/** Pulls the first dollar amount out of a quote like "$850, paint included" for sorting. */
export function quoteCents(quote: string | null): number {
  if (!quote) return Infinity;
  const m = quote.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  return m?.[1] ? Math.round(Number(m[1]) * 100) : Infinity;
}

export type Level = "New" | "Bronze" | "Silver" | "Gold";

/** Seller level from completed swaps and rating. Higher levels show first and earn more trust. */
export function level(jobs: number, avg: number): Level {
  if (jobs >= 20 && avg >= 4.5) return "Gold";
  if (jobs >= 5 && avg >= 4.0) return "Silver";
  if (jobs >= 1) return "Bronze";
  return "New";
}

export const LEVEL_ICON: Record<Level, string> = { New: "🆕", Bronze: "🥉", Silver: "🥈", Gold: "🥇" };

/** How complete a listing is (0-100), and the one thing to add next. */
export function profileScore(l: { photos: number; text: string; hasPrice: boolean; verified: boolean }): { score: number; tip: string | null } {
  let score = 0;
  const tips: string[] = [];
  if (l.photos > 0) score += 40;
  else tips.push("Add photos to get far more interest.");
  if (l.text.length >= 40) score += 20;
  else tips.push("Write a longer description (what, size, condition).");
  if (l.hasPrice) score += 20;
  else tips.push("Add a price so buyers can compare.");
  if (l.verified) score += 20;
  else tips.push("Ask us to verify you for the ✅ badge.");
  return { score, tip: tips[0] ?? null };
}
