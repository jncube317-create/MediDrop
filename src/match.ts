// Decides which providers get a lead for a post. Pure: no WhatsApp, no state.

export interface NeedLike {
  owner: string;
  category: string;
  area: string;
  text: string;
}

export interface OfferLike {
  id: string;
  owner: string;
  category: string;
  area: string;
  coversAll: boolean;
  text: string;
  active: boolean;
  ratingSum: number;
  ratingCount: number;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "need", "want", "looking", "someone", "who", "can", "fix", "please", "help",
  "my", "a", "an", "to", "of", "in", "on", "at", "is", "it", "i", "me", "we", "our", "your", "you", "from",
  "this", "that", "some", "any", "new", "used", "good", "cheap", "urgent", "today", "week",
]);

/** Lower-case words of 3+ letters, minus common filler words. */
export function keywords(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

export function averageRating(o: Pick<OfferLike, "ratingSum" | "ratingCount">): number {
  return o.ratingCount === 0 ? 0 : o.ratingSum / o.ratingCount;
}

/** Null = this offer must not get the lead. Higher = better match. */
export function score(need: NeedLike, offer: OfferLike): number | null {
  if (!offer.active) return null;
  if (offer.owner === need.owner) return null; // never send someone their own post
  if (offer.category !== need.category) return null;
  const sameArea = offer.area === need.area;
  if (!sameArea && !offer.coversAll) return null;

  let points = sameArea ? 3 : 1;
  const offerWords = new Set(keywords(offer.text));
  const overlap = keywords(need.text).filter((w) => offerWords.has(w)).length;
  points += Math.min(overlap, 3);
  points += averageRating(offer) / 5; // 0 to 1, breaks ties toward better-rated providers
  return points;
}

/** The best offers for a need, skipping any that already got a lead for it. */
export function pickMatches<T extends OfferLike>(need: NeedLike, offers: T[], skip: Set<string>, limit: number): T[] {
  return offers
    .filter((o) => !skip.has(o.id))
    .map((o) => ({ o, s: score(need, o) }))
    .filter((x): x is { o: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.o);
}
