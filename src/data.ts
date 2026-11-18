// Categories, areas, credit bundles and the sample providers used in the demo.
// Everything here is placeholder data: change it freely.

export interface Category {
  key: string;
  name: string; // list row title, max 24 chars
  example: string; // shown when asking what they need or offer
  people: string; // "carpenters", used in messages
}

export const CATEGORIES: Category[] = [
  { key: "carpentry", name: "Carpentry & furniture", example: "Fix a wardrobe door / build kitchen units", people: "carpenters" },
  { key: "mechanic", name: "Mechanic & car repair", example: "Car won't start / service and brakes", people: "mechanics" },
  { key: "plumbing", name: "Plumbing", example: "Leaking geyser / blocked drain", people: "plumbers" },
  { key: "electrical", name: "Electrical & solar", example: "Install a solar system / fix wiring", people: "electricians" },
  { key: "building", name: "Building & painting", example: "Paint a 3-room house / build a wall", people: "builders" },
  { key: "beauty", name: "Hair & beauty", example: "Braids at home / nails for a wedding", people: "hair and beauty pros" },
  { key: "cars", name: "Cars & car parts", example: "Toyota Vitz under $3,000 / Corolla side mirror", people: "car and parts sellers" },
  { key: "phones", name: "Phones & electronics", example: "Samsung A15 screen / used laptop", people: "sellers" },
  { key: "clothes", name: "Clothes & shoes", example: "School uniforms size 10 / men's boots", people: "sellers" },
  { key: "other", name: "Something else", example: "Tell us what you need in a few words", people: "people" },
];

export interface Area {
  key: string;
  name: string; // list row title, max 24 chars
}

export const AREAS: Area[] = [
  { key: "cbd", name: "City centre" },
  { key: "north", name: "Northern suburbs" },
  { key: "east", name: "Eastern suburbs" },
  { key: "south", name: "Southern suburbs" },
  { key: "west", name: "Western suburbs" },
  { key: "outside", name: "Outside Bulawayo" },
];

export type When = "today" | "week" | "flexible";
export const WHEN_LABEL: Record<When, string> = { today: "Today", week: "This week", flexible: "Flexible" };

export interface Bundle {
  key: string;
  credits: number;
  cents: number;
}

// Placeholder prices to test. 1 credit = 1 number swap, paid by each side.
export const BUNDLES: Bundle[] = [
  { key: "b2", credits: 2, cents: 100 },
  { key: "b5", credits: 5, cents: 200 },
  { key: "b15", credits: 15, cents: 500 },
];

export const WELCOME_CREDITS = 3;
export const MAX_ACTIVE_OFFERS = 3;
export const MAX_CONNECTIONS_PER_NEED = 3;
export const LEADS_PER_NEED = 5;

export function getCategory(key: string): Category | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

export function getArea(key: string): Area | undefined {
  return AREAS.find((a) => a.key === key);
}

export function getBundle(key: string): Bundle | undefined {
  return BUNDLES.find((b) => b.key === key);
}

export interface SampleProvider {
  phone: string; // fake, never messaged
  name: string;
  category: string;
  area: string;
  coversAll: boolean;
  text: string;
  price: string | null;
  ratingSum: number;
  ratingCount: number;
  jobs: number;
}

// Fictional providers so a demo with one phone still gets replies.
// Their numbers start 26300 so they can never be a real Zimbabwe mobile.
export const SAMPLE_PROVIDERS: SampleProvider[] = [
  { phone: "263000000001", name: "Thabo M.", category: "carpentry", area: "west", coversAll: true, text: "Wardrobes, doors, kitchen units and repairs. 10 years' experience.", price: "From $15 call-out", ratingSum: 85, ratingCount: 18, jobs: 22 },
  { phone: "263000000002", name: "Nomsa D.", category: "carpentry", area: "east", coversAll: false, text: "Furniture repairs and custom beds. I bring my own tools.", price: null, ratingSum: 40, ratingCount: 9, jobs: 11 },
  { phone: "263000000003", name: "Tendai's Garage", category: "mechanic", area: "cbd", coversAll: true, text: "Service, brakes, suspension. Mobile mechanic, I come to you.", price: "From $20", ratingSum: 143, ratingCount: 31, jobs: 40 },
  { phone: "263000000004", name: "Sipho N.", category: "mechanic", area: "north", coversAll: false, text: "Toyota and Honda specialist. Diagnostics and engine work.", price: null, ratingSum: 26, ratingCount: 6, jobs: 7 },
  { phone: "263000000005", name: "Brian Plumbing", category: "plumbing", area: "south", coversAll: true, text: "Geysers, leaks, blocked drains. Same-day call-outs.", price: "From $10", ratingSum: 62, ratingCount: 14, jobs: 19 },
  { phone: "263000000006", name: "Lindiwe Solar", category: "electrical", area: "north", coversAll: true, text: "Solar installs, inverters and house wiring.", price: null, ratingSum: 47, ratingCount: 10, jobs: 12 },
  { phone: "263000000007", name: "Mpilo Spares", category: "cars", area: "cbd", coversAll: true, text: "New and used parts for Toyota, Honda and Nissan.", price: null, ratingSum: 70, ratingCount: 16, jobs: 25 },
  { phone: "263000000008", name: "Kuda Phones", category: "phones", area: "cbd", coversAll: true, text: "Screens, batteries and charging ports. Used phones for sale.", price: "Screens from $25", ratingSum: 52, ratingCount: 12, jobs: 30 },
];

/** Shortens text to fit a WhatsApp title, adding … when cut. */
export function fit(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}
