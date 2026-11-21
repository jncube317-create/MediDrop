// Categories, cities, credit bundles, banned words and the sample listings used in demos.
// Everything here is placeholder data: change it freely.

export type Kind = "item" | "service";

export interface Category {
  key: string;
  kind: Kind;
  name: string; // list row title, max 24 chars
  example: string; // shown when asking what they need or offer
  people: string; // "carpenters", used in messages
  swapCost: number; // credits each side uses when numbers are swapped
  pharmacyOnly?: boolean; // only admin-approved, licensed pharmacies can list here
}

export const CATEGORIES: Category[] = [
  // ---- items (new and pre-loved)
  { key: "cars", kind: "item", name: "Cars & bakkies", example: "Toyota Vitz under $3,000 / single cab bakkie", people: "car sellers", swapCost: 1 },
  { key: "pharmacy", kind: "item", name: "Pharmacy & medicines", example: "Panado tablets", people: "licensed pharmacies", swapCost: 1, pharmacyOnly: true },
  { key: "carparts", kind: "item", name: "Car parts", example: "Corolla 2008 side mirror", people: "parts sellers", swapCost: 1 },
  { key: "appliances", kind: "item", name: "Fridges & appliances", example: "Combi fridge / 2-plate stove / washing machine", people: "sellers", swapCost: 1 },
  { key: "furniture", kind: "item", name: "Furniture & household", example: "3-seater couch / double bed", people: "sellers", swapCost: 1 },
  { key: "building", kind: "item", name: "Doors & building supply", example: "Steel front door / roofing sheets", people: "suppliers", swapCost: 1 },
  { key: "phones", kind: "item", name: "Phones & electronics", example: "Samsung A15 / used laptop", people: "sellers", swapCost: 1 },
  { key: "fashion", kind: "item", name: "Clothes & shoes", example: "Ladies sandals size 5 / school uniforms", people: "sellers", swapCost: 1 },
  { key: "property", kind: "item", name: "Houses & rentals", example: "2-bed to rent in Hillside", people: "landlords and agents", swapCost: 1 },
  // ---- services
  { key: "carpentry", kind: "service", name: "Carpentry & furniture", example: "Fix a wardrobe door / build kitchen units", people: "carpenters", swapCost: 1 },
  { key: "mechanic", kind: "service", name: "Mechanic & car repair", example: "Car won't start / service and brakes", people: "mechanics", swapCost: 1 },
  { key: "plumbing", kind: "service", name: "Plumbing", example: "Leaking geyser / blocked drain", people: "plumbers", swapCost: 1 },
  { key: "electrical", kind: "service", name: "Electrical & solar", example: "Install a solar system / fix wiring", people: "electricians", swapCost: 1 },
  { key: "painting", kind: "service", name: "Building & painting", example: "Paint 6 rooms, Dulux, fix and supply", people: "builders and painters", swapCost: 1 },
  { key: "beauty", kind: "service", name: "Hair & beauty", example: "Makeup for a wedding / braids at home", people: "hair and beauty pros", swapCost: 1 },
  { key: "events", kind: "service", name: "Venues & events", example: "Venue for 40 people / DJ / catering", people: "event providers", swapCost: 1 },
  { key: "printing", kind: "service", name: "Printing & branding", example: "200 vinyl stickers / T-shirt printing", people: "printers", swapCost: 1 },
  { key: "moving", kind: "service", name: "Moving & transport", example: "Move a fridge from City Hall to Country Park", people: "movers", swapCost: 1 },
  { key: "other", kind: "service", name: "Something else", example: "Tell us what you need in a few words", people: "people", swapCost: 1 },
];

export interface City {
  key: string;
  name: string;
}

export const CITIES: City[] = [
  { key: "byo", name: "Bulawayo" },
  { key: "hre", name: "Harare" },
  { key: "gweru", name: "Gweru" },
  { key: "mutare", name: "Mutare" },
  { key: "masvingo", name: "Masvingo" },
  { key: "kwekwe", name: "Kwekwe" },
  { key: "vicfalls", name: "Victoria Falls" },
  { key: "chinhoyi", name: "Chinhoyi" },
  { key: "other", name: "Another town" },
];

export type WhenKey = "today" | "week" | "date" | "flexible";
export const WHEN_LABEL: Record<WhenKey, string> = { today: "Today", week: "This week", date: "On a date", flexible: "Flexible" };

export type Condition = "new" | "good" | "used";
export const CONDITION_LABEL: Record<Condition, string> = { new: "New", good: "Pre-loved · good", used: "Pre-loved · used" };

export interface Bundle {
  key: string;
  credits: number;
  cents: number;
}

// Placeholder prices to test. $2 is the smallest so EcoCash/Paynow fees don't eat it.
export const BUNDLES: Bundle[] = [
  // Free users get 3 credits a week, so these are for active buyers and sellers.
  // 50c → 43c → 38c per credit: a real reward for the bigger bundle without giving swaps away.
  { key: "b2", credits: 2, cents: 100 },
  { key: "b7", credits: 7, cents: 300 },
  { key: "b13", credits: 13, cents: 500 },
];

export const WELCOME_CREDITS = 3;
/** Every week (Monday, Harare time) everyone gets this many free credits, once per week. */
export const WEEKLY_FREE_CREDITS = 3;

/**
 * When a post stops being useful: "today" ends at midnight Harare time, "this week" at the end of
 * Sunday. Null for flexible or a typed date (those use the normal 7-day expiry).
 */
export function wantedBy(when: WhenKey, createdAt: number): number | null {
  const HARARE = 2 * 3600_000;
  const d = new Date(createdAt + HARARE);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - HARARE;
  if (when === "today") return midnight;
  if (when === "week") return midnight + ((7 - d.getUTCDay()) % 7) * 24 * 3600_000;
  return null;
}

/** Monday of the current week in Harare (UTC+2), as YYYY-MM-DD. Used as the weekly top-up key. */
export function weekKey(now = Date.now()): string {
  const d = new Date(now + 2 * 3600_000);
  const back = (d.getUTCDay() + 6) % 7; // days since Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back)).toISOString().slice(0, 10);
}
export const MAX_ACTIVE_LISTINGS = 5;
export const MAX_CONNECTIONS_PER_NEED = 3;
export const LEADS_PER_NEED = 5;
export const CARDS_PER_RESULT = 9; // + 1 sponsored = carousel max of 10
export const AD_TAP_COST = 1;

// Posts containing these are refused and flagged to the admin. Whole words/phrases only.
export const BANNED = [
  "dagga", "mbanje", "cocaine", "heroin", "crystal meth", "mutoriro", "weed for sale", "bronco", "broncleer",
  "firearm", "pistol", "ammunition", "rifle for sale", "gun for sale",
  "stolen", "fake id", "fake passport", "fake documents", "counterfeit",
  "ivory", "rhino horn", "pangolin", "explosives",
];

/** Medicines: anyone may search for them, but only licensed pharmacies may list or sell them. */
export const MEDICINE_WORDS = [
  "medicine", "medicines", "medication", "medications", "prescription", "prescriptions", "pharmacy drugs",
  "antibiotic", "antibiotics", "tramadol", "codeine", "diazepam", "valium", "morphine",
  "pethidine", "viagra", "cialis", "pills", "sleeping pills", "painkillers", "pain killers", "cough syrup",
  "steroids", "misoprostol", "abortion pills", "arvs", "insulin",
];

export type BlockReason = { kind: "link" } | { kind: "contact" } | { kind: "code" } | { kind: "banned"; word: string } | { kind: "medicine"; word: string };

const LINK = /(https?:\/\/|www\.|wa\.me\/|t\.me\/|bit\.ly|tinyurl|\b[a-z0-9-]+\.(com|net|org|info|biz|io|co|me|ly|link|xyz|app|site|online|shop|store|top|click|live|zw|za)\b)/i;

// Phone numbers and emails: numbers are only shared by Scoutly once both people agree (and pay).
const CONTACT = /(?:\+|\b00)?\b263[\s-]*7\d(?:[\s-]*\d){7}\b|\b0\s*7\d(?:[\s-]*\d){7}\b|\b\d{10,}\b|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

function looksLikeCode(text: string): boolean {
  const t = text.trim();
  if (/^[\[{][\s\S]*[\]}]$/.test(t)) return true; // JSON object or array
  if (/"[^"]{1,40}"\s*:\s*/.test(t) && /[{}]/.test(t)) return true; // "key": value
  if (/<\/?[a-z][a-z0-9]*[^>]*>/i.test(t)) return true; // HTML tags
  if (/```|\$\{|<\?php|\bselect\b.+\bfrom\b|\bdrop\s+table\b|\bunion\s+select\b/i.test(t)) return true;
  return false;
}

/** Why a typed message must not be processed, or null if it's fine. Checked on every typed message. */
export function blockedReason(text: string): BlockReason | null {
  if (LINK.test(text)) return { kind: "link" };
  if (CONTACT.test(text)) return { kind: "contact" };
  if (looksLikeCode(text)) return { kind: "code" };
  const banned = bannedWord(text);
  if (banned) return { kind: "banned", word: banned };
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  const med = MEDICINE_WORDS.find((w) => t.includes(` ${w} `));
  if (med) return { kind: "medicine", word: med };
  return null;
}

export function medicineWord(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  return MEDICINE_WORDS.find((w) => t.includes(` ${w} `)) ?? null;
}

export function bannedWord(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ")} `;
  return BANNED.find((w) => t.includes(` ${w} `)) ?? null;
}

export function getCategory(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}
export function categoriesOf(kind: Kind): Category[] {
  return CATEGORIES.filter((c) => c.kind === kind);
}
export function getCity(key: string): City | undefined {
  return CITIES.find((c) => c.key === key);
}
export function getBundle(key: string): Bundle | undefined {
  return BUNDLES.find((b) => b.key === key);
}

/** "$5,500" / "5500" / "US$ 520.50" → cents. Null if no number. */
export function parseDollars(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)\s*(k)?/i);
  if (!m?.[1]) return null;
  const value = Number(m[1]) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return Math.round(value * 100);
}

/** Shortens text to fit a WhatsApp title, adding … when cut. */
export function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------- demo data

export interface SampleSeller {
  phone: string; // starts 26300: can never be a real mobile, never messaged
  name: string;
  verified: boolean;
}

export const SAMPLE_SELLERS: SampleSeller[] = [
  { phone: "263000000011", name: "Tawanda K.", verified: false },
  { phone: "263000000012", name: "Busi M.", verified: false },
  { phone: "263000000013", name: "BYO Home Appliances", verified: true },
  { phone: "263000000014", name: "Nomvula S.", verified: false },
  { phone: "263000000015", name: "Ndlovu Steel Works", verified: true },
  { phone: "263000000001", name: "Thabo M.", verified: true },
  { phone: "263000000003", name: "Tendai's Garage", verified: true },
  { phone: "263000000005", name: "Brian Plumbing", verified: false },
  { phone: "263000000006", name: "Lindiwe Solar", verified: true },
  { phone: "263000000007", name: "Sipho Painters", verified: false },
  { phone: "263000000008", name: "Glam by Rue", verified: false },
  { phone: "263000000009", name: "Hillside Event Garden", verified: true },
  { phone: "263000000010", name: "Print Hub BYO", verified: false },
  { phone: "263000000016", name: "Mpilo Movers", verified: false },
  { phone: "263000000020", name: "Ace Paint Centre", verified: true },
  { phone: "263000000021", name: "Kudu Car Cover", verified: true },
];

export interface SampleListing {
  seller: string; // phone
  kind: Kind;
  category: string;
  title: string;
  text: string;
  priceCents: number | null;
  priceText: string | null;
  condition: Condition | null;
  photo: string | null; // file in public/demo
  nationwide: boolean;
  ratingSum: number;
  ratingCount: number;
  jobs: number;
  quote: string | null; // what a sample service provider "quotes"
}

// Prices are realistic samples (Nov 2026 research), not real offers.
export const SAMPLE_LISTINGS: SampleListing[] = [
  { seller: "263000000011", kind: "item", category: "cars", title: "BMW 7 Series 745i", text: "Silver, automatic, leather seats. Minor scuffs on the front bumper. Papers in order (seller states).", priceCents: 550000, priceText: null, condition: "used", photo: "bmw745.jpg", nationwide: true, ratingSum: 9, ratingCount: 2, jobs: 2, quote: null },
  { seller: "263000000012", kind: "item", category: "cars", title: "Nissan NP300 single cab", text: "White Hardbody bakkie with canopy. Clean interior, ideal for work.", priceCents: 850000, priceText: null, condition: "good", photo: "np300.jpg", nationwide: true, ratingSum: 14, ratingCount: 3, jobs: 3, quote: null },
  { seller: "263000000013", kind: "item", category: "appliances", title: "Defy combi fridge", text: "Silver bottom-freezer combi, A+ energy rating. Boxed, with warranty.", priceCents: 52000, priceText: null, condition: "new", photo: "fridge.jpg", nationwide: false, ratingSum: 113, ratingCount: 24, jobs: 31, quote: null },
  { seller: "263000000014", kind: "item", category: "fashion", title: "Brown woven mules", text: "Ladies mules with gold buckle, size 5. Worn twice.", priceCents: 1200, priceText: null, condition: "good", photo: "sandals.jpg", nationwide: false, ratingSum: 5, ratingCount: 1, jobs: 1, quote: null },
  { seller: "263000000015", kind: "item", category: "building", title: "Steel door, charcoal", text: "Modern steel front door with frosted side glass. Made to order, fitting available.", priceCents: 48000, priceText: null, condition: "new", photo: "door-charcoal.jpg", nationwide: true, ratingSum: 88, ratingCount: 19, jobs: 26, quote: null },
  { seller: "263000000015", kind: "item", category: "building", title: "Steel security door, blue", text: "Steel door with fanlight and laser-cut side panel. Made to order, fitting available.", priceCents: 42000, priceText: null, condition: "new", photo: "door-blue.jpg", nationwide: true, ratingSum: 88, ratingCount: 19, jobs: 26, quote: null },
  // services
  { seller: "263000000001", kind: "service", category: "carpentry", title: "Thabo M. Carpentry", text: "Wardrobes, doors, kitchen units and repairs. 10 years' experience.", priceCents: null, priceText: "From $15 call-out", condition: null, photo: null, nationwide: false, ratingSum: 85, ratingCount: 18, jobs: 22, quote: "$45 for the door and hinges, can come tomorrow" },
  { seller: "263000000003", kind: "service", category: "mechanic", title: "Tendai's Garage", text: "Service, brakes, suspension. Mobile mechanic, I come to you.", priceCents: null, priceText: "From $20", condition: null, photo: null, nationwide: false, ratingSum: 143, ratingCount: 31, jobs: 40, quote: "$35 diagnosis, today after 2pm" },
  { seller: "263000000005", kind: "service", category: "plumbing", title: "Brian Plumbing", text: "Geysers, leaks, blocked drains. Same-day call-outs.", priceCents: null, priceText: "From $10", condition: null, photo: null, nationwide: false, ratingSum: 62, ratingCount: 14, jobs: 19, quote: "$25 call-out plus parts, within 2 hours" },
  { seller: "263000000006", kind: "service", category: "electrical", title: "Lindiwe Solar", text: "Solar installs, inverters and house wiring.", priceCents: null, priceText: null, condition: null, photo: null, nationwide: false, ratingSum: 47, ratingCount: 10, jobs: 12, quote: "Site visit free, quote after" },
  { seller: "263000000007", kind: "service", category: "painting", title: "Sipho Painters", text: "Interior and exterior painting, Dulux and Plascon. Fix and supply.", priceCents: null, priceText: "From $60 a room", condition: null, photo: null, nationwide: false, ratingSum: 61, ratingCount: 14, jobs: 17, quote: "$850, paint included, 4 days" },
  { seller: "263000000008", kind: "service", category: "beauty", title: "Glam by Rue", text: "Makeup for weddings, parties and nights out. I come to you.", priceCents: null, priceText: "From $20", condition: null, photo: null, nationwide: false, ratingSum: 44, ratingCount: 9, jobs: 15, quote: "$25 a face, December slots open" },
  { seller: "263000000009", kind: "service", category: "events", title: "Hillside Event Garden", text: "Garden venue near town for up to 60 people. Birthdays and parties.", priceCents: null, priceText: "From $120 a day", condition: null, photo: null, nationwide: false, ratingSum: 38, ratingCount: 8, jobs: 10, quote: "$120 for the day, chairs and tables included" },
  { seller: "263000000010", kind: "service", category: "printing", title: "Print Hub BYO", text: "Vinyl stickers, banners and T-shirts. High-quality print.", priceCents: null, priceText: null, condition: null, photo: null, nationwide: false, ratingSum: 92, ratingCount: 19, jobs: 38, quote: "$55 for 200 matte stickers, 2 days" },
  { seller: "263000000016", kind: "service", category: "moving", title: "Mpilo Movers", text: "1-ton truck with 2 helpers. Moves across Bulawayo.", priceCents: null, priceText: "From $25", condition: null, photo: null, nationwide: false, ratingSum: 40, ratingCount: 9, jobs: 14, quote: "$30, can do it this afternoon" },
];

export interface SampleAd {
  owner: string;
  category: string;
  text: string;
  photo: string;
}

export const SAMPLE_ADS: SampleAd[] = [
  { owner: "263000000020", category: "painting", text: "Ace Paint Centre: Dulux 20L from $95, free delivery in town", photo: "ad-paint.jpg" },
  { owner: "263000000021", category: "cars", text: "Kudu Car Cover: insure your next car from $12 a month", photo: "ad-insurance.jpg" },
];
