// Reads a search typed in one message ("pre-loved fridge, budget $100") and pulls out what it can,
// so the bot doesn't ask again. Pure and rule-based (no AI): a word list per category, plus
// patterns for budget, timing and town. Anything it can't work out stays undefined and is asked.

import type { WhenKey } from "./data";

/** Words and short phrases that point to a category. Phrases count double. */
const WORDS: Record<string, string[]> = {
  // items
  cars: ["motorbike", "motorcycle", "bike", "bicycle", "fuel saver", "fuel savers", "ex jap", "ex-jap", "toyota aqua", "toyota wish", "honda fit", "fit hybrid", "nissan note", "nissan march", "toyota ist", "sienta", "noah", "voxy", "hiace", "raum", "passo", "belta", "spacio", "auris", "harrier", "forester", "golf", "polo", "car", "cars", "vehicle", "vitz", "honda fit", "toyota", "nissan", "mazda", "bmw", "mercedes", "benz", "hilux", "ranger", "bakkie", "pickup", "sedan", "suv", "hatchback", "corolla", "isuzu", "kombi", "quantum", "truck", "single cab", "double cab", "np300", "navara", "prado", "rav4", "demio", "axio", "allion", "premio"],
  carparts: ["tyre", "tyres", "tire", "tires", "rims", "gearbox", "bumper", "headlight", "headlights", "spares", "spare parts", "car parts", "exhaust", "radiator", "shocks", "side mirror", "brake pads", "alternator", "car battery"],
  appliances: ["defy", "hisense", "kic", "capri", "univa", "sinotec", "telefunken", "bosch", "kenwood", "russell hobbs", "dvd player", "dvd", "decoder", "home theatre", "fridge", "fridges", "refrigerator", "freezer", "deep freezer", "stove", "microwave", "washing machine", "kettle", "tv", "television", "aircon", "air conditioner", "heater", "geyser", "iron", "blender", "toaster", "dishwasher", "gas stove", "hot plate"],
  furniture: ["ottoman", "recliner", "sofa", "couch", "lounge suite", "bed", "mattress", "table", "chair", "chairs", "wardrobe", "desk", "cabinet", "dining", "dining set", "bunk bed", "headboard", "dressing table", "bookshelf", "curtains", "carpet"],
  building: ["roof", "jojo", "jojo tank", "water tank", "door", "doors", "window", "windows", "cement", "bricks", "roofing", "roofing sheets", "tiles", "timber", "gate", "steel door", "sand", "river sand", "pit sand", "quarry", "ibr", "zinc", "paint tin", "wall tiles"],
  phones: ["cable", "huawei", "tecno", "infinix", "itel", "xiaomi", "redmi", "oppo", "nokia", "hp", "dell", "lenovo", "acer", "asus", "macbook", "apple", "sony", "jbl", "phone", "phones", "iphone", "samsung", "laptop", "laptops", "tablet", "ipad", "smartphone", "charger", "airpods", "computer", "ps5", "ps4", "playstation", "xbox", "earphones", "speaker", "router", "camera", "smartwatch"],
  fashion: ["polo shirt", "nike", "adidas", "puma", "jordan", "jordans", "air force", "converse", "vans", "reebok", "new balance", "timberland", "crocs", "gucci", "zara", "shoe", "sneaker", "shoes", "sneakers", "dress", "dresses", "clothes", "jacket", "sandals", "handbag", "jeans", "shirt", "suit", "uniform", "uniforms", "heels", "boots", "skirt", "trousers", "hoodie", "tracksuit"],
  property: ["boarding house", "room to rent", "rooms to rent", "house", "room", "rooms", "flat", "apartment", "cottage", "stand", "land", "plot", "rent", "rental", "to rent", "lodge", "bedroom", "bedroomed", "office space", "shop space", "boarding", "accommodation", "garden flat", "townhouse"],
  // services
  carpentry: ["carpenter", "carpentry", "cupboards", "kitchen units", "built in", "built-in", "fitted wardrobe"],
  mechanic: ["mechanic", "car service", "service my car", "car repair", "panel beater", "panel beating", "auto electrician", "car won't start", "brakes", "wheel alignment"],
  plumbing: ["plumber", "plumbing", "leak", "leaking", "blocked drain", "drain", "toilet", "burst pipe", "geyser repair", "borehole"],
  electrical: ["electrician", "electrical", "wiring", "solar", "solar system", "inverter", "panels", "rewiring", "dstv installation", "cctv"],
  painting: ["painter", "painting", "builder", "builders", "plaster", "plastering", "tiler", "tiling", "bricklayer", "renovation", "renovations", "roofing contractor", "build a house"],
  beauty: ["hair", "braids", "makeup", "make up", "nails", "barber", "salon", "lashes", "wig", "hairdresser", "dreadlocks", "facial", "massage"],
  events: ["venue", "wedding", "decor", "catering", "caterer", "dj", "mc", "party", "event", "tent", "photographer", "videographer", "birthday", "conference room", "chairs hire"],
  printing: ["printing", "print", "banner", "banners", "stickers", "vinyl", "flyers", "branding", "t-shirt printing", "business cards", "signage", "embroidery"],
  moving: ["moving", "movers", "removals", "truck hire", "transport", "delivery", "lorry", "relocate", "move house"],
  other: ["tutor", "tutoring", "lessons", "cleaner", "cleaning", "gardener", "garden", "maid", "nanny", "security guard", "driver", "laundry", "pest control", "fumigation", "web design", "graphic design"],
};

const REPAIR = /\b(fix|fixing|repair|repairs|repairing|service|servicing|install|installation|installing|maintenance)\b/i;
const SERVICE_KEYS = new Set(["carpentry", "mechanic", "plumbing", "electrical", "painting", "beauty", "events", "printing", "moving", "other"]);

export interface Understood {
  category?: string; // best guess, or undefined if unclear / tied
  budgetCents?: number;
  budgetText?: string;
  when?: WhenKey;
  whenText?: string;
  anywhere?: boolean;
  city?: string; // a town named in the message ("in Harare")
}

const norm = (t: string) => ` ${t.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").replace(/\s+/g, " ").trim()} `;

/** Category with the most hits. Undefined when nothing matches or two categories tie. */
/** Plural and singular count as the same word: "shoes" = "shoe". */
const stemWord = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/** Typos up to 1 letter (2 for long words): "niker" → "nike", "samsang" → "samsung", "fridg" → "fridge". */
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const max = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > max) return false;
  // Damerau-Levenshtein (adjacent swaps count as one mistake)
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
    }
  return d[a.length]![b.length]! <= max;
}

/** Everyday words that must never be "corrected" into a product (like → nike, bake → bike). */
const NOT_TYPOS = new Set([
  "like", "look", "looking", "need", "want", "have", "with", "from", "this", "that", "some", "cheap", "good", "used", "near", "town", "week", "today", "please", "anyone",
  "selling", "buying", "price", "budget", "under", "around", "about", "make", "made", "more", "less", "best", "nice", "very", "much", "time", "home", "house", "work",
  "deal", "deals", "dear", "bell", "sell", "tell", "well", "pump", "item", "items", "acre", "acres", "song", "cross", "gold", "hand", "band", "roof", "cable", "boost", "pole", "bake", "cake", "mike", "lake", "hike", "pike", "fine", "fire", "wire", "tire", "hire", "mine", "line", "mind", "kind", "find", "door", "bare", "care", "core",
]);

/** Category with the most hits. Undefined when nothing matches or two categories tie. */
export function guessCategory(text: string): string | undefined {
  const t = norm(text);
  const tokens = t.trim().split(" ").filter(Boolean).map(stemWord);
  const scores = new Map<string, number>();
  for (const [key, words] of Object.entries(WORDS)) {
    let s = 0;
    for (const w of words) {
      const word = w.replace(/-/g, " ");
      if (word.includes(" ")) {
        if (t.includes(` ${word} `)) s += 2; // phrases: exact
        continue;
      }
      const target = stemWord(word);
      if (tokens.includes(target)) s += 1;
      else if (tokens.some((tok) => !NOT_TYPOS.has(tok) && closeEnough(tok, target))) s += 0.75; // a typo counts, a bit less
    }
    if (s) scores.set(key, s);
  }
  // "fix my fridge", "install solar": a repair word turns an item into a job.
  if (REPAIR.test(text)) {
    for (const key of [...scores.keys()]) if (!SERVICE_KEYS.has(key)) scores.delete(key);
    if (!scores.size) return "other";
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return undefined;
  if (ranked[1] && ranked[1][1] === ranked[0]![1]) return undefined; // tie: ask
  return ranked[0]![0];
}

/** "$100", "budget 100", "under 5000", "max 300", "5k", "100 dollars", "usd 250". Not "250l" or "3 bedroom". */
export function findBudget(text: string): { cents: number; text: string } | undefined {
  const t = text.toLowerCase().replace(/,/g, "");
  const pats = [
    /(?:us)?\$\s*(\d+(?:\.\d{1,2})?)\s*(k)?\b/,
    /\b(?:budget|under|below|max|maximum|up to|upto|less than|around|about|not more than)\s*(?:of\s*)?(?:is\s*)?(?:us)?\$?\s*(\d+(?:\.\d{1,2})?)\s*(k)?\b/,
    /\b(\d+(?:\.\d{1,2})?)\s*(k)?\s*(?:usd|us dollars|dollars|bucks)\b/,
    /\busd\s*(\d+(?:\.\d{1,2})?)\s*(k)?\b/,
  ];
  for (const p of pats) {
    const m = t.match(p);
    if (!m?.[1]) continue;
    const dollars = Number(m[1]) * (m[2] ? 1000 : 1);
    if (!Number.isFinite(dollars) || dollars <= 0 || dollars > 5_000_000) continue;
    const cents = Math.round(dollars * 100);
    return { cents, text: `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 2 })}` };
  }
  return undefined;
}

/** Timing words. Default is undefined (the caller uses "flexible"). */
export function findWhen(text: string): { when: WhenKey; text?: string } | undefined {
  const t = text.toLowerCase();
  if (/\b(today|tonight|urgent|urgently|asap|now|right away)\b/.test(t)) return { when: "today" };
  if (/\b(this week|tomorrow|this weekend|by friday|in a few days)\b/.test(t)) return { when: "week" };
  const date = t.match(/\b(?:on\s+)?((?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+)?(\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/);
  if (date) return { when: "date", text: date[0].replace(/^on\s+/, "") };
  return undefined;
}

/**
 * The thing itself, for repeating back: "Looking for a fuel saver budget 4000" → "a fuel saver".
 * Drops "I'm looking for", "I need", budget and timing words.
 */
export function subjectOf(text: string): string {
  let t = ` ${text.trim()} `;
  t = t.replace(/^\s*(hi|hello|hey|please|pls)\b[,!. ]*/i, " ");
  t = t.replace(/^\s*(i\s*'?\s*a?m\s+|i\s+am\s+)?(looking|searching|hunting)\s+for\s+/i, " ");
  t = t.replace(/^\s*(i\s+)?(need|want|would like|am after|'m after)\s+(to\s+(buy|find|get)\s+)?/i, " ");
  t = t.replace(/^\s*(where can i (get|buy|find)|anyone (selling|with|who has))\s+/i, " ");
  t = t.replace(/[,;]?\s*\b(with\s+)?(a\s+)?(budget|under|below|max|maximum|up to|upto|less than|around|not more than)\b.*$/i, " ");
  t = t.replace(/[,;]?\s*(us)?\$\s*\d[\d,.]*\s*k?\b.*$/i, " ");
  t = t.replace(/[,;]?\s*\b(today|tonight|urgently|urgent|asap|this week|tomorrow|anywhere in zim\w*)\b.*$/i, " ");
  t = t.replace(/\s+/g, " ").replace(/[\s,.;:!?-]+$/g, "").trim();
  return t || text.trim();
}

/** Reads one typed search. `cities` lets it spot "in Harare" or "anywhere". */
export function understand(text: string, cities: { key: string; name: string }[]): Understood {
  const out: Understood = {};
  const cat = guessCategory(text);
  if (cat) out.category = cat;
  const b = findBudget(text);
  if (b) {
    out.budgetCents = b.cents;
    out.budgetText = b.text;
  }
  const w = findWhen(text);
  if (w) {
    out.when = w.when;
    if (w.text) out.whenText = w.text;
  }
  const t = text.toLowerCase();
  if (/\b(anywhere|any town|any city|nationwide|countrywide|whole country|all of zim|anywhere in zim)/.test(t)) out.anywhere = true;
  for (const c of cities) {
    if (c.key === "other") continue;
    if (new RegExp(`\\b(in|from|around|near)\\s+${c.name.toLowerCase()}\\b`).test(t) || new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(t)) {
      out.city = c.key;
      break;
    }
  }
  return out;
}
