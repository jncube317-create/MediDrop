// Demo seed data. All pharmacies are fictional. Prices are placeholders in cents.

export type ZoneKey = "CBD" | "INNER" | "OUTER";

export interface Zone {
  key: ZoneKey;
  label: string;
  feeCents: number;
  suburbs: string[];
}

export const ZONES: Record<ZoneKey, Zone> = {
  CBD: { key: "CBD", label: "CBD", feeCents: 200, suburbs: ["City Centre", "Belmont", "Thorngrove"] },
  INNER: {
    key: "INNER",
    label: "Inner",
    feeCents: 300,
    suburbs: ["Suburbs", "Hillside", "Kumalo", "Parklands", "Newton West", "Bradfield", "Morningside", "Malindela"],
  },
  OUTER: {
    key: "OUTER",
    label: "Outer",
    feeCents: 400,
    suburbs: ["Nkulumane", "Pumula", "Cowdray Park", "Luveve", "Entumbane", "Burnside", "Emganwini", "Magwegwe", "Lobengula"],
  },
};

export interface Pharmacy {
  id: string;
  name: string;
  suburb: string;
  address: string;
  opensAt: string; // "HH:MM", Africa/Harare time
  closesAt: string;
}

export const PHARMACIES: Pharmacy[] = [
  { id: "p1", name: "CityCare Pharmacy", suburb: "City Centre", address: "Fife St & 9th Ave", opensAt: "07:00", closesAt: "21:00" },
  { id: "p2", name: "Hillside Chemists", suburb: "Hillside", address: "Hillside Shops", opensAt: "07:00", closesAt: "21:00" },
  { id: "p3", name: "Nkulumane MedPoint", suburb: "Nkulumane", address: "Nkulumane Complex", opensAt: "07:00", closesAt: "21:00" },
  // Closes early on purpose, so the demo shows closed pharmacies being hidden.
  { id: "p4", name: "Parklands Pharmacy", suburb: "Parklands", address: "Parklands Centre", opensAt: "08:00", closesAt: "13:00" },
];

export interface Medicine {
  id: string;
  name: string; // shown to customers, max 24 chars
  aliases: string[];
  rx: boolean;
  deliveryAllowed: boolean;
  maxQty: number;
  // price in cents per pharmacy id; missing = not stocked
  prices: Partial<Record<string, number>>;
}

export const MEDICINES: Medicine[] = [
  { id: "m01", name: "Paracetamol 500mg x20", aliases: ["paracetamol", "panado", "panadol", "pain tablets"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 150, p2: 180, p3: 120, p4: 160 } },
  { id: "m02", name: "Ibuprofen 200mg x24", aliases: ["ibuprofen", "brufen", "nurofen"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 350, p2: 320, p4: 300 } },
  { id: "m03", name: "Cetirizine 10mg x10", aliases: ["cetirizine", "zyrtec", "allergy"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 400, p2: 450, p3: 380 } },
  { id: "m04", name: "Loratadine 10mg x10", aliases: ["loratadine", "clarityne", "allergy"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 420, p3: 400, p4: 390 } },
  { id: "m05", name: "ORS sachets x5", aliases: ["ors", "oral rehydration", "rehydration salts"], rx: false, deliveryAllowed: true, maxQty: 5, prices: { p1: 250, p2: 260, p3: 200, p4: 240 } },
  { id: "m06", name: "Vitamin C 1000mg x10", aliases: ["vitamin c", "vit c", "redoxon", "effervescent"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 500, p2: 550, p3: 480 } },
  { id: "m07", name: "Antacid liquid 150ml", aliases: ["antacid", "gaviscon", "heartburn", "indigestion"], rx: false, deliveryAllowed: true, maxQty: 2, prices: { p1: 650, p2: 600, p4: 620 } },
  { id: "m08", name: "Cough syrup 100ml", aliases: ["cough syrup", "cough mixture", "benylin", "cough"], rx: false, deliveryAllowed: true, maxQty: 2, prices: { p1: 550, p2: 520, p3: 500, p4: 580 } },
  { id: "m09", name: "Throat lozenges x16", aliases: ["lozenges", "strepsils", "sore throat"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 300, p2: 280, p3: 290 } },
  { id: "m10", name: "Zinc 20mg x10", aliases: ["zinc", "zinc tablets"], rx: false, deliveryAllowed: true, maxQty: 3, prices: { p1: 200, p3: 180 } },
  { id: "m11", name: "Multivitamin x30", aliases: ["multivitamin", "vitamins", "centrum"], rx: false, deliveryAllowed: true, maxQty: 2, prices: { p1: 800, p2: 750, p3: 820, p4: 780 } },
  { id: "m12", name: "Hydrocortisone cream 1%", aliases: ["hydrocortisone", "cortisone cream", "rash cream"], rx: false, deliveryAllowed: true, maxQty: 2, prices: { p1: 450, p2: 470 } },
  { id: "m13", name: "Amoxicillin 500mg x15", aliases: ["amoxicillin", "amoxil", "amoxyl", "antibiotic"], rx: true, deliveryAllowed: true, maxQty: 1, prices: { p1: 600, p2: 650, p3: 550, p4: 620 } },
  { id: "m14", name: "Metformin 500mg x60", aliases: ["metformin", "glucophage", "diabetes"], rx: true, deliveryAllowed: true, maxQty: 2, prices: { p1: 700, p2: 680, p3: 720 } },
  { id: "m15", name: "Amlodipine 5mg x30", aliases: ["amlodipine", "norvasc", "blood pressure", "bp tablets"], rx: true, deliveryAllowed: true, maxQty: 2, prices: { p1: 500, p3: 480, p4: 520 } },
];

export function getMedicine(id: string): Medicine | undefined {
  return MEDICINES.find((m) => m.id === id);
}

export function getPharmacy(id: string): Pharmacy | undefined {
  return PHARMACIES.find((p) => p.id === id);
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

/** Keyword + typo-tolerant search over names and brand/generic aliases. */
export function findMedicines(query: string): Medicine[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  const qWords = q.split(" ");
  return MEDICINES.filter((m) => {
    const terms = [normalize(m.name), ...m.aliases.map(normalize)];
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

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function harareMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Harare",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

export function isOpen(pharmacy: Pharmacy, now: Date): boolean {
  const t = harareMinutes(now);
  return t >= minutesOf(pharmacy.opensAt) && t < minutesOf(pharmacy.closesAt);
}

export interface PharmacyOffer {
  pharmacy: Pharmacy;
  priceCents: number;
}

/** Open pharmacies that stock this medicine, cheapest first. */
export function offersFor(medicine: Medicine, now: Date, ignoreHours: boolean): PharmacyOffer[] {
  const offers: PharmacyOffer[] = [];
  for (const pharmacy of PHARMACIES) {
    const price = medicine.prices[pharmacy.id];
    if (price === undefined) continue;
    if (!ignoreHours && !isOpen(pharmacy, now)) continue;
    offers.push({ pharmacy, priceCents: price });
  }
  return offers.sort((a, b) => a.priceCents - b.priceCents);
}
