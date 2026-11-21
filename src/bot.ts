// Scoutly conversation logic.
//
// Buyers post what they're looking for (a "need"): budget, when, where.
//   • Items (cars, fridges, doors, shoes…): matching listings come back at once as swipeable picture
//     cards, new and pre-loved side by side, cheapest first. "I'm interested" asks the seller.
//   • Services (painters, mechanics…): the post goes to matching providers, they reply with a quote,
//     and the buyer compares quotes before swapping numbers.
// Sellers list items or services once, with photos, and buyers come to them.
// Numbers are swapped only when both sides say yes. Each side uses credits for a swap.
// Sponsored cards (self-serve, admin-approved) show last in results and are paid per tap.
//
// State is kept in memory (fine for the demo; v1 stores it in a database).

import { env } from "./env";
import * as wa from "./wa";
import {
  AD_TAP_COST,
  BUNDLES,
  CARDS_PER_RESULT,
  CITIES,
  CONDITION_LABEL,
  LEADS_PER_NEED,
  MAX_ACTIVE_LISTINGS,
  MAX_CONNECTIONS_PER_NEED,
  SAMPLE_ADS,
  SAMPLE_LISTINGS,
  SAMPLE_SELLERS,
  WELCOME_CREDITS,
  WEEKLY_FREE_CREDITS,
  weekKey,
  wantedBy,
  WHEN_LABEL,
  bannedWord,
  categoriesOf,
  fit,
  getBundle,
  getCategory,
  getCity,
  parseDollars,
  type Condition,
  type Kind,
  type WhenKey,
  blockedReason,
  medicineWord,
} from "./data";
import { Ledger, type Entry } from "./credits";
import { LEVEL_ICON, averageRating, eligible, level, profileScore, quoteCents, rankItems, rankProviders } from "./match";
import { chatLink, isOpen, isStale, moveLead, prettyPhone, type Lead } from "./leads";
import { formatUsd } from "./money";
import { checkPayment, startPayment } from "./pay";
import { formatLocalNumber, networkMatches, normalizeZwMobile, toLocalNumber } from "./paystatus";
import { track } from "./analytics";
import { demoPhoto, savePhoto } from "./media";
import { dbEnabled, loadTable, upsert, type CreditRow, type Row } from "./store";
import { understand } from "./parse";
import type { CarouselCard } from "./limits";

export type Incoming =
  | { from: string; kind: "text"; text: string }
  | { from: string; kind: "reply"; id: string }
  | { from: string; kind: "image"; mediaId: string }
  | { from: string; kind: "other" };

type Mode = "find" | "sell" | "ad";

type Step =
  | "ASK_CONSENT" | "ASK_NAME" | "ASK_CITY" | "ASK_ROLE"
  | "PROF_NAME" | "PROF_ABOUT" | "PROF_PHOTO" | "PROF_CONFIRM"
  | "MENU"
  | "CAT_KIND" | "CAT_PICK"
  | "FIND_TEXT" | "FIND_BUDGET" | "FIND_WHEN" | "FIND_DATE" | "FIND_WHERE" | "FIND_CONFIRM"
  | "SELL_TITLE" | "SELL_DESC" | "SELL_COND" | "SELL_PRICE" | "SELL_PHOTOS" | "SELL_COVER" | "SELL_CONFIRM"
  | "QUOTE_TEXT" | "PHARM_DETAILS"
  | "AD_TEXT" | "AD_PHOTO" | "AD_WHERE" | "AD_CONFIRM"
  | "BUY_PAYER" | "BUY_OTHER_NUMBER" | "BUY_WAIT";

interface Draft {
  mode?: Mode;
  kind?: Kind;
  category?: string;
  text?: string;
  title?: string;
  budgetText?: string | null;
  budgetCents?: number | null;
  when?: WhenKey;
  whenText?: string | null;
  anywhere?: boolean;
  city?: string; // town named in the search, if different from the user's own
  condition?: Condition | null;
  priceCents?: number | null;
  priceText?: string | null;
  photos?: string[];
  nationwide?: boolean;
  bundle?: string;
  profile?: Partial<Profile>;
  next?: "find" | "sell" | "menu"; // where to go after the profile is saved
  editing?: string; // need being changed from the results (closed and re-run)
}

/** What buyers see about a seller or service provider. */
interface Profile {
  name: string; // business or trading name
  about: string; // what they sell or offer
  photo: string; // logo, shop front or a clear photo of them or their work
}

interface User {
  phone: string;
  name: string | null;
  profile: Profile | null;
  city: string | null;
  verified: boolean;
  pharmacy?: { details: string; approvedAt: number } | null; // licensed pharmacy, approved by admin
  pharmacyApplication?: string | null;
  lastWeekly?: string; // week the free top-up was last checked
  step: Step;
  draft: Draft;
  changingCity: boolean;
  pendingLeadId: string | null; // provider/seller waiting for a top-up
  pendingConnId: string | null; // buyer swap waiting for a top-up
  pendingCard: { listingId: string; needId: string | null } | null; // buyer interest waiting for a top-up
  quoteLeadId: string | null;
  purchaseId: string | null;
  updatedAt: number;
  reprompt: (() => Promise<unknown>) | null;
}

interface Need {
  id: string;
  owner: string;
  kind: Kind;
  category: string;
  city: string;
  anywhere: boolean;
  text: string;
  budgetText: string | null;
  budgetCents: number | null;
  when: WhenKey;
  whenText: string | null;
  alert: boolean;
  createdAt: number;
  status: "OPEN" | "CLOSED" | "EXPIRED";
  connections: number;
}

interface Listing {
  id: string;
  owner: string;
  kind: Kind;
  category: string;
  city: string;
  nationwide: boolean;
  title: string;
  text: string;
  priceCents: number | null;
  priceText: string | null;
  condition: Condition | null;
  photos: string[];
  active: boolean;
  sold: boolean;
  ratingSum: number;
  ratingCount: number;
  jobs: number;
  strikes: number;
  sample: boolean;
  sampleQuote: string | null;
  createdAt: number;
}

interface Ad {
  id: string;
  owner: string;
  category: string;
  city: string | null; // null = anywhere
  text: string;
  photo: string | null;
  status: "PENDING" | "LIVE" | "REJECTED" | "PAUSED";
  views: number;
  taps: number;
  createdAt: number;
}

interface Purchase {
  id: string;
  phone: string;
  credits: number;
  cents: number;
  status: "PENDING" | "PAID" | "FAILED";
  pollUrl: string | null;
  simulated: boolean;
  startedAt: number;
}

const users = new Map<string, User>();
const needs = new Map<string, Need>();
const listings = new Map<string, Listing>();
const leads = new Map<string, Lead>();
const ads = new Map<string, Ad>();
const purchases = new Map<string, Purchase>();
const ledger = new Ledger();
let needSeq = 1000;
let listingSeq = 500;
let leadSeq = 0;
let adSeq = 10;
let purchaseSeq = 100;

const DRAFT_TIMEOUT_MS = 30 * 60 * 1000;
const NEED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;
const NOT_DRAFT: Step[] = ["ASK_CONSENT", "ASK_NAME", "ASK_CITY", "ASK_ROLE", "MENU", "BUY_WAIT"];
const LIABILITY = `⚖️ ${env.APP_NAME} only connects you. We aren't part of any deal and aren't responsible for it.`;

// ---------------------------------------------------------------- demo data

function newUser(phone: string): User {
  return {
    phone, name: null, profile: null, city: null, verified: false, step: "ASK_CONSENT", draft: {}, changingCity: false,
    pendingLeadId: null, pendingConnId: null, pendingCard: null, quoteLeadId: null, purchaseId: null,
    updatedAt: Date.now(), reprompt: null,
  };
}

function seedSamples(): void {
  if (!env.SAMPLE_PROVIDERS) return;
  for (const s of SAMPLE_SELLERS) {
    users.set(s.phone, { ...newUser(s.phone), name: s.name, city: "byo", verified: s.verified, step: "MENU" });
    ledger.grant(s.phone, 10_000, `sample:${s.phone}`);
  }
  for (const s of SAMPLE_LISTINGS) {
    const id = `O-${++listingSeq}`;
    listings.set(id, {
      id, owner: s.seller, kind: s.kind, category: s.category, city: "byo", nationwide: s.nationwide,
      title: s.title, text: s.text, priceCents: s.priceCents, priceText: s.priceText, condition: s.condition,
      photos: s.photo ? [demoPhoto(s.photo)] : [], active: true, sold: false,
      ratingSum: s.ratingSum, ratingCount: s.ratingCount, jobs: s.jobs, strikes: 0, sample: true, sampleQuote: s.quote, createdAt: Date.now(),
    });
  }
  for (const a of SAMPLE_ADS) {
    const id = `AD-${++adSeq}`;
    ads.set(id, { id, owner: a.owner, category: a.category, city: null, text: a.text, photo: demoPhoto(a.photo), status: "LIVE", views: 0, taps: 0, createdAt: Date.now() });
  }
  console.log(`[DEMO] ${SAMPLE_LISTINGS.length} sample listings and ${SAMPLE_ADS.length} sample ads loaded (test mode only)`);
}
// ---------------------------------------------------------------- saving to Supabase

type Table = "users" | "needs" | "listings" | "leads" | "ads" | "purchases";
const TABLES: { name: Table; map: Map<string, object>; skip: (v: any) => boolean }[] = [
  { name: "users", map: users, skip: (u: User) => isSample(u.phone) },
  { name: "needs", map: needs, skip: (n: Need) => isSample(n.owner) },
  { name: "listings", map: listings, skip: (l: Listing) => Boolean(l.sample) || isSample(l.owner) },
  { name: "leads", map: leads, skip: (l: Lead) => isSample(l.provider) || isSample(l.customer) },
  { name: "ads", map: ads, skip: (a: Ad) => isSample(a.owner) },
  { name: "purchases", map: purchases, skip: () => false },
];
const savedJson = new Map<string, string>();
let savedEntries = 0;
let savedSeq = "";
let flushing = false;

const seqs = () => ({ needSeq, listingSeq, leadSeq, adSeq, purchaseSeq });
const maxNum = (ids: Iterable<string>) => Math.max(0, ...[...ids].map((id) => Number(id.replace(/\D/g, "")) || 0));

/** Loads saved data (if Supabase is set), then adds the demo samples. Call once before serving. */
export async function initState(): Promise<void> {
  if (dbEnabled()) {
    for (const t of TABLES) {
      const rows = await loadTable<Row>(t.name, "id,data");
      for (const r of rows) {
        const v = r.data as Record<string, unknown>;
        if (t.name === "users") v.reprompt = null; // functions aren't saved
        t.map.set(r.id, v);
        savedJson.set(`${t.name}:${r.id}`, JSON.stringify(v));
      }
    }
    const entries = await loadTable<CreditRow>("credit_entries", "key,phone,delta,kind,at");
    ledger.load(entries.map((e) => ({ key: e.key, phone: e.phone, delta: e.delta, kind: e.kind as Entry["kind"], at: Date.parse(e.at) })));
    savedEntries = ledger.all().length;
    const meta = await loadTable<{ key: string; value: Partial<ReturnType<typeof seqs>> }>("meta", "key,value");
    const saved = meta.find((m) => m.key === "seq")?.value ?? {};
    needSeq = Math.max(needSeq, saved.needSeq ?? 0, maxNum(needs.keys()));
    listingSeq = Math.max(listingSeq, saved.listingSeq ?? 0, maxNum(listings.keys()));
    leadSeq = Math.max(leadSeq, saved.leadSeq ?? 0, maxNum(leads.keys()));
    adSeq = Math.max(adSeq, saved.adSeq ?? 0, maxNum(ads.keys()));
    purchaseSeq = Math.max(purchaseSeq, saved.purchaseSeq ?? 0, maxNum(purchases.keys()));
    console.log(`[DB] Loaded ${users.size} users, ${needs.size} posts, ${listings.size} listings, ${leads.size} leads, ${savedEntries} credit entries.`);
    setInterval(() => void flushState(), 2000).unref();
  } else {
    console.warn("⚠️ No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: data lives in memory and is wiped on every redeploy.");
  }
  seedSamples();
}

/** Saves anything that changed since the last save. Runs every 2 seconds and on shutdown. */
export async function flushState(): Promise<void> {
  if (!dbEnabled() || flushing) return;
  flushing = true;
  try {
    for (const t of TABLES) {
      const changed: { id: string; data: unknown; updated_at: string; json: string }[] = [];
      for (const [id, v] of t.map) {
        if (t.skip(v)) continue;
        const json = JSON.stringify(v);
        if (savedJson.get(`${t.name}:${id}`) !== json) changed.push({ id, data: JSON.parse(json), updated_at: new Date().toISOString(), json });
      }
      if (!changed.length) continue;
      await upsert(t.name, changed.map(({ json: _json, ...row }) => row));
      for (const c of changed) savedJson.set(`${t.name}:${c.id}`, c.json);
    }
    const all = ledger.all();
    if (all.length > savedEntries) {
      const fresh = all.slice(savedEntries).filter((e) => !isSample(e.phone));
      if (fresh.length) await upsert("credit_entries", fresh.map((e) => ({ key: e.key, phone: e.phone, delta: e.delta, kind: e.kind, at: new Date(e.at).toISOString() })), true);
      savedEntries = all.length;
    }
    const seq = JSON.stringify(seqs());
    if (seq !== savedSeq) {
      await upsert("meta", [{ key: "seq", value: seqs() }]);
      savedSeq = seq;
    }
  } catch (err) {
    console.error("[DB] save failed, will retry:", err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

// ---------------------------------------------------------------- helpers

function user(phone: string): { u: User; timedOut: boolean } {
  let u = users.get(phone);
  if (!u) {
    u = newUser(phone);
    users.set(phone, u);
  }
  const timedOut = !NOT_DRAFT.includes(u.step) && Date.now() - u.updatedAt > DRAFT_TIMEOUT_MS;
  u.updatedAt = Date.now();
  return { u, timedOut };
}

const textOf = (m: Incoming) => (m.kind === "text" ? m.text.trim() : "");
const replyId = (m: Incoming) => (m.kind === "reply" ? m.id : "");
const nameOf = (phone: string) => users.get(phone)?.profile?.name ?? users.get(phone)?.name ?? "Someone";
const cityName = (key: string | null) => (key ? getCity(key)?.name ?? key : "your town");
const catName = (key: string) => getCategory(key)?.name ?? key;
const costOf = (category: string) => getCategory(category)?.swapCost ?? 1;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const credits = (n: number) => plural(n, "credit");
const isSample = (phone: string) => phone.startsWith("26300");
const isAdmin = (phone: string) => Boolean(env.ADMIN_PHONE) && phone === env.ADMIN_PHONE;
const clean = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

async function prompt(u: User, fn: () => Promise<unknown>): Promise<void> {
  u.reprompt = fn;
  await fn();
}

async function didntGetThat(u: User): Promise<void> {
  await wa.sendText(u.phone, "Sorry, I didn't get that. Type MENU to start over.");
  if (u.reprompt) await u.reprompt();
}

/** Never message the fake sample numbers. */
async function tell(phone: string, body: string): Promise<void> {
  if (isSample(phone)) return;
  await wa.sendText(phone, body);
}

/** 550000 → "$5,500"; 52050 → "$520.50". */
/** "$100" from the saved cents (so a typed "100" still shows as money), else the typed text. */
function budgetOf(n: { budgetCents?: number | null; budgetText?: string | null }): string | null {
  if (typeof n.budgetCents === "number") return dollars(n.budgetCents);
  return n.budgetText ?? null;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function priceLabel(l: Listing): string {
  if (l.priceCents !== null) return dollars(l.priceCents);
  return l.priceText ?? "Ask for price";
}

function badges(l: Listing): string {
  const avg = averageRating(l);
  const lv = level(l.jobs, avg);
  const stars = l.ratingCount ? `⭐ ${avg.toFixed(1)} (${l.ratingCount})` : "⭐ New";
  const owner = users.get(l.owner);
  return `${LEVEL_ICON[lv]} ${lv} · ${stars}${owner?.pharmacy ? " · 💊 Licensed pharmacy" : owner?.verified ? " · ✅ Verified" : ""}`;
}

/** Fits a carousel card: max 160 characters and 2 line breaks. */
function cardText(l: Listing): string {
  const cond = l.condition ? (l.condition === "new" ? "New" : "Pre-loved") : catName(l.category);
  const where = l.nationwide ? "Nationwide" : cityName(l.city);
  // fit() would squash the line breaks, so each line is shortened on its own.
  return `${fit(l.title, 40)}\n${fit(`${priceLabel(l)} · ${cond} · ${where}`, 50)}\n${fit(badges(l), 60)}`;
}

function cardImage(l: Listing): string {
  return l.photos[0] ?? demoPhoto("no-photo.jpg");
}

async function anythingElse(to: string, body = "Anything else we can help you with?"): Promise<void> {
  await wa.sendButtons(to, body, [
    { id: "menu:find", title: "Find something" },
    { id: "menu:sell", title: "Sell or offer" },
    { id: "menu:main", title: "Main menu" },
  ]);
}

function leadsFor(needId: string): Lead[] {
  return [...leads.values()].filter((l) => l.needId === needId);
}

function activeListingsOf(phone: string): Listing[] {
  return [...listings.values()].filter((l) => l.owner === phone && l.active && !l.sold);
}

/** Refuses illegal posts and tells the admin. True if refused. */
async function refusedAsBanned(u: User, text: string): Promise<boolean> {
  const word = bannedWord(text);
  if (!word) return false;
  u.draft = {};
  u.step = "MENU";
  track("post_refused", u.phone, { reason: "banned_word" });
  await wa.sendText(u.phone, `Sorry, we can't post that. ${env.APP_NAME} doesn't allow illegal goods or services. Type TERMS to see the rules.`);
  if (env.ADMIN_PHONE) await wa.sendText(env.ADMIN_PHONE, `🚫 *Post blocked* (word: "${word}")\nFrom: ${u.name ?? "?"} ${prettyPhone(u.phone)}\n"${fit(text, 200)}"`);
  return true;
}

// ---------------------------------------------------------------- entry point

export async function handleIncoming(m: Incoming): Promise<void> {
  if (isAdmin(m.from) && /^(stats|lookup|grant|verify|ads|pharmacy\s+\+?\d|unpharmacy\s+\+?\d)/i.test(textOf(m))) return adminCommand(m.from, textOf(m));
  if (isAdmin(m.from) && m.kind === "reply" && /^pharm:(ok|no):\d+$/.test(m.id)) {
    const [, verdict, phone] = m.id.split(":");
    return reviewPharmacy(m.from, phone ?? "", verdict === "ok");
  }
  if (m.kind === "text" && (await refusedInput(m.from, m.text))) return;
  return conversation(m);
}

/** Every typed message is checked first: no links, no code or JSON, no illegal goods, no medicines. */
async function refusedInput(phone: string, text: string): Promise<boolean> {
  const why = blockedReason(text);
  if (!why) return false;
  track("input_refused", phone, { reason: why.kind });
  const u = users.get(phone);
  switch (why.kind) {
    case "link":
      await wa.sendText(phone, `For everyone's safety, ${env.APP_NAME} doesn't accept links or web addresses. Please describe it in words instead.`);
      return true;
    case "contact":
      await wa.sendText(phone, `Please don't type phone numbers or emails here. ${env.APP_NAME} swaps numbers for you once both of you agree, so nobody sees your number before that.`);
      return true;
    case "code":
      await wa.sendText(phone, "Sorry, I can only read normal text. Please type your message in plain words.");
      return true;
    case "medicine": {
      // Searching for medicine is fine (we only show licensed pharmacies). Selling it is pharmacies only.
      const selling = u ? /^(SELL_|AD_|PROF_)/.test(u.step) || u.draft.mode === "sell" || u.draft.mode === "ad" : false;
      if (!selling || u?.pharmacy) return false;
      u!.draft = {};
      u!.step = "MENU";
      await wa.sendText(phone, `Only *licensed pharmacies* can sell medicines on ${env.APP_NAME}. If you're a pharmacy, type PHARMACY to apply.\n\nLooking for medicine? Type MENU and search for it, and we'll show you licensed pharmacies.`);
      if (env.ADMIN_PHONE) await wa.sendText(env.ADMIN_PHONE, `💊 *Medicine listing blocked* (word: "${why.word}")\nFrom: ${u?.name ?? "?"} ${prettyPhone(phone)}\n"${fit(text, 200)}"`);
      return true;
    }
    case "banned":
      if (u) { u.draft = {}; u.step = u.step.startsWith("ASK_") ? u.step : "MENU"; }
      await wa.sendText(phone, `Sorry, we can't accept that. ${env.APP_NAME} doesn't allow illegal goods or services. Type TERMS to see the rules.`);
      if (env.ADMIN_PHONE) await wa.sendText(env.ADMIN_PHONE, `🚫 *Blocked* (word: "${why.word}")\nFrom: ${u?.name ?? "?"} ${prettyPhone(phone)}\n"${fit(text, 200)}"`);
      return true;
  }
}

async function conversation(m: Incoming): Promise<void> {
  const to = m.from;
  const { u, timedOut } = user(to);
  const text = textOf(m);
  const id = replyId(m);

  if (timedOut) {
    u.step = "MENU";
    u.draft = {};
    await wa.sendText(to, "Your unfinished post timed out, so we've cleared it.");
  }

  // ---- weekly free credits: 3 for everyone, once a week (first message of the week, from Monday)
  if (u.city && u.lastWeekly !== weekKey()) {
    u.lastWeekly = weekKey();
    const added = ledger.weekly(u.phone, WEEKLY_FREE_CREDITS, u.lastWeekly);
    if (added > 0) {
      track("weekly_credits", to, { added });
      await wa.sendText(to, `🎁 Your ${WEEKLY_FREE_CREDITS} free weekly credits are here. You now have *${credits(ledger.balance(to))}*. You get ${WEEKLY_FREE_CREDITS} more every Monday.`);
    }
  }

  // ---- first contact: consent → name → city
  if (u.step === "ASK_CONSENT") {
    if (id === "consent:yes") {
      console.log(`[CONSENT] ...${to.slice(-4)} agreed at ${new Date().toISOString()} (text v3: no-liability + no illegal goods)`);
      u.step = "ASK_NAME";
      await wa.sendText(to, "Thank you 🙏 What's your first name?");
      return;
    }
    if (id === "consent:no") return void (await wa.sendText(to, "No problem. We need this to connect you with people, so we can't continue without it. Type HI if you change your mind."));
    if (id === "terms") return showTerms(to);
    return askConsent(to);
  }
  if (u.step === "ASK_NAME") {
    if (!text) return void (await wa.sendText(to, "Please type your first name."));
    u.name = clean(text, 30);
    return askCity(u);
  }
  if (u.step === "ASK_CITY") {
    const city = id.startsWith("city:") ? getCity(id.slice(5)) : undefined;
    if (!city) return didntGetThat(u);
    const first = u.city === null;
    u.city = city.key;
    if (u.changingCity && u.draft.mode === "find") {
      u.changingCity = false;
      return findSummary(u);
    }
    u.changingCity = false;
    if (first) {
      ledger.welcome(u.phone, WELCOME_CREDITS);
      u.lastWeekly = weekKey(); // sign-up week is covered by the welcome credits
      track("signed_up", to, { city: city.key });
      return askRole(u);
    }
    return showMenu(u, `📍 Your town is now ${city.name}.`);
  }

  if (u.step === "ASK_ROLE") {
    const next = id === "role:buy" ? "find" : id === "role:sell" ? "sell" : id === "role:both" ? "menu" : null;
    if (next) {
      track("role_chosen", to, { role: next === "find" ? "buyer" : next === "sell" ? "seller" : "both" });
      return startProfile(
        u,
        "Great 👍 First, a quick profile. Everyone on Scoutly has one, so people know who they're dealing with before swapping numbers. It also means you're ready the day you sell something.",
        next,
      );
    }
    if (/^(menu|hi|hello|hey|start)$/i.test(text)) return showMenu(u, `Hi ${u.name} 👋`);
    return didntGetThat(u);
  }

  // ---- words that work anywhere (any capitals)
  if (/^(menu|hi|hello|hey|start)$/i.test(text)) {
    if (u.step === "BUY_WAIT") return waitingForPayment(to);
    return showMenu(u, `Hi ${u.name} 👋`);
  }
  if (/^help$/i.test(text)) return showHelp(u);
  if (/^terms$/i.test(text)) return showTerms(to);
  if (/^credits?$/i.test(text)) return showCredits(u);
  if (/^stop$/i.test(text)) return stopAlerts(u);
  if (/^pharmacy$/i.test(text)) return askPharmacyDetails(u);

  // ---- photos
  if (m.kind === "image") {
    if (u.step === "PROF_PHOTO") return addProfilePhoto(u, m.mediaId);
    if (u.step === "SELL_PHOTOS") return addListingPhoto(u, m.mediaId);
    if (u.step === "AD_PHOTO") return addAdPhoto(u, m.mediaId);
    return void (await wa.sendText(to, "Nice photo! To show it to buyers, list your item: type MENU → Sell or offer."));
  }

  // ---- taps on cards and leads work from anywhere: those messages stay in the chat
  const [kind, a, b] = id.split(":");
  switch (kind) {
    case "int":
      return buyerInterested(u, a ?? "", b && b !== "-" ? b : null);
    case "sell":
      return sellerResponds(to, b ?? "", a === "yes");
    case "lead":
      return providerResponds(u, b ?? "", a === "yes");
    case "conn":
      return customerResponds(to, b ?? "", a === "yes");
    case "q":
      return showQuote(to, a ?? "");
    case "report":
      return reportLead(to, a ?? "");
    case "found":
      return foundIt(u, b ?? "", a === "yes");
    case "alert":
      return setAlert(u, b ?? "", a === "on");
    case "adtap":
      return adTapped(u, a ?? "");
    case "ad":
      if (a === "ok" || a === "no") return reviewAd(to, b ?? "", a === "ok");
      break;
    case "ratepick":
      return askRatingFor(u, a ?? "");
    case "rating":
      return saveRating(u, a ?? "", Number(b));
    case "post":
      return showPost(u, a ?? "", b ?? "");
    case "rate":
      return pickWhoToRate(u, a ?? "");
    case "close":
      return closeMyNeed(u, a ?? "");
    case "sold":
      return markSold(u, a ?? "");
    case "pause":
    case "resume":
      return toggleListing(u, a ?? "", kind === "resume");
  }

  if (u.step === "BUY_WAIT") return waitingForPayment(to);

  if (id.startsWith("buy:")) return startBuy(u, id.slice(4));
  if (id.startsWith("edit:menu:")) return editMenu(u, id.slice(10));
  {
    const m = id.match(/^edit:(budget|cat|any|here):(N-\d+)$/);
    if (m) return editSearch(u, m[2]!, m[1]!);
  }
  if (id === "prof:redo") return startProfile(u, "Okay, let's update your profile.");
  if (id === "adnew") return askKind(u, "ad");
  if (id.startsWith("menu:")) {
    u.draft = {};
    switch (id) {
      case "menu:main":
        return showMenu(u, "Main menu");
      case "menu:find":
        if (!u.profile) return startProfile(u, "Before you search, a quick profile. Sellers see it before they swap numbers with you. It takes 1 minute.", "find");
        u.draft = { mode: "find" };
        return askFindText(u);
      case "menu:sell":
        return startSell(u);
      case "menu:posts":
        return showPosts(u);
      case "menu:profile":
        return showProfile(u);
      case "menu:credits":
        return showCredits(u);
      case "menu:ads":
        return showAdvertise(u);
      case "menu:city":
        u.changingCity = true;
        return askCity(u);
      case "menu:help":
        return showHelp(u);
    }
  }

  switch (u.step) {
    case "MENU": {
      // Typing straight away = "I'm looking for this".
      if (text.length >= 3) {
        if (await refusedAsBanned(u, text)) return;
        if (!u.profile) {
          await startProfile(u, "Got it 👍 Before we search, a quick profile. Sellers see it before they swap numbers with you. It takes 1 minute.", "find");
          u.draft.text = clean(text, 300);
          return;
        }
        return quickFind(u, text);
      }
      return didntGetThat(u);
    }

    // ---- pharmacy application
    case "PHARM_DETAILS": {
      if (text.length < 25) return void (await wa.sendText(to, "Please send all the details in one message: pharmacy name, physical address, MCAZ premises licence number, and the responsible pharmacist's name."));
      u.pharmacyApplication = clean(text, 400);
      u.step = "MENU";
      track("pharmacy_applied", to, {});
      await wa.sendText(to, "Thank you 🙏 We'll check your licence and reply here, usually within 1–2 working days.");
      if (env.ADMIN_PHONE)
        await wa.sendButtons(env.ADMIN_PHONE, `💊 *Pharmacy application*\nFrom: ${nameOf(to)} ${prettyPhone(to)}\n\n"${u.pharmacyApplication}"\n\nCheck the licence with MCAZ before approving.`, [
          { id: `pharm:ok:${to}`, title: "Approve" },
          { id: `pharm:no:${to}`, title: "Reject" },
        ]);
      return;
    }

    // ---- seller profile
    case "PROF_NAME": {
      const name = id === "prof:usename" ? u.name ?? "" : text;
      if (name.length < 2) return didntGetThat(u);
      if (await refusedAsBanned(u, name)) return;
      u.draft.profile = { ...u.draft.profile, name: clean(name, 40) };
      return askProfileAbout(u);
    }
    case "PROF_ABOUT": {
      if (text.length < 15) return void (await wa.sendText(to, "Please write a bit more (at least one full sentence), so buyers know what you do."));
      if (await refusedAsBanned(u, text)) return;
      u.draft.profile = { ...u.draft.profile, about: clean(text, 200) };
      return askProfilePhoto(u);
    }
    case "PROF_PHOTO": {
      return void (await wa.sendText(to, "Please send a *photo* (tap 📎 or 📷). A profile photo is needed before you can sell. Type MENU to do it later."));
    }
    case "PROF_CONFIRM": {
      if (id === "prof:ok") return saveProfile(u);
      if (id === "prof:photo") return askProfilePhoto(u);
      if (id === "prof:edit") return startProfile(u, "Okay, let's go through it again.");
      return didntGetThat(u);
    }

    case "CAT_KIND": {
      if (id !== "kind:item" && id !== "kind:service") return didntGetThat(u);
      u.draft.kind = id === "kind:item" ? "item" : "service";
      return askCategory(u);
    }

    case "CAT_PICK": {
      const cat = id.startsWith("cat:") ? getCategory(id.slice(4)) : undefined;
      if (!cat) return didntGetThat(u);
      if (cat.pharmacyOnly && (u.draft.mode === "sell" || u.draft.mode === "ad") && !u.pharmacy) {
        u.draft = {};
        u.step = "MENU";
        return void (await wa.sendText(to, `Only *licensed pharmacies* can list medicines on ${env.APP_NAME}. If you're a pharmacy, type PHARMACY to apply. Type MENU to do something else.`));
      }
      u.draft.category = cat.key;
      if (u.draft.mode === "sell") return cat.kind === "item" ? askSellTitle(u) : askSellDesc(u);
      if (u.draft.mode === "ad") return askAdText(u);
      return u.draft.text ? createNeed(u) : askFindText(u);
    }

    // ---- find
    case "FIND_TEXT": {
      if (text.length < 3) return void (await wa.sendText(to, "Please describe it in a few words."));
      if (await refusedAsBanned(u, text)) return;
      return quickFind(u, text);
    }
    case "FIND_BUDGET": {
      if (id === "budget:skip") {
        u.draft.budgetText = null;
        u.draft.budgetCents = null;
      } else if (text) {
        u.draft.budgetText = clean(text, 40);
        u.draft.budgetCents = parseDollars(text);
      } else return didntGetThat(u);
      if (u.draft.editing) return createNeed(u);
      return askWhen(u);
    }
    case "FIND_WHEN": {
      const when = id.startsWith("when:") ? (id.slice(5) as WhenKey) : null;
      if (!when || !(when in WHEN_LABEL)) return didntGetThat(u);
      u.draft.when = when;
      u.draft.whenText = null;
      if (when === "date") {
        u.step = "FIND_DATE";
        return prompt(u, () => wa.sendText(to, "Type the date and time, e.g. _Sat 20 Dec, 2pm_"));
      }
      return askWhere(u);
    }
    case "FIND_DATE": {
      if (!text) return didntGetThat(u);
      u.draft.whenText = clean(text, 40);
      return askWhere(u);
    }
    case "FIND_WHERE": {
      if (id !== "where:city" && id !== "where:any") return didntGetThat(u);
      u.draft.anywhere = id === "where:any";
      return findSummary(u);
    }
    case "FIND_CONFIRM": {
      if (id === "need:post") return createNeed(u);
      if (id === "need:cancel") return showMenu(u, "Okay, nothing was posted.");
      return didntGetThat(u);
    }

    // ---- sell
    case "SELL_TITLE": {
      if (text.length < 3) return void (await wa.sendText(to, "Please name it in a few words."));
      if (await refusedAsBanned(u, text)) return;
      u.draft.title = clean(text, 60);
      return askSellDesc(u);
    }
    case "SELL_DESC": {
      if (id === "desc:skip" && u.draft.kind === "item") u.draft.text = "";
      else if (text.length >= 4) {
        if (await refusedAsBanned(u, text)) return;
        u.draft.text = clean(text, 300);
      } else return void (await wa.sendText(to, "Please describe it in a sentence or two."));
      return u.draft.kind === "item" ? askCondition(u) : askPrice(u);
    }
    case "SELL_COND": {
      const cond = id.startsWith("cond:") ? (id.slice(5) as Condition) : null;
      if (!cond || !(cond in CONDITION_LABEL)) return didntGetThat(u);
      u.draft.condition = cond;
      return askPrice(u);
    }
    case "SELL_PRICE": {
      if (u.draft.kind === "item") {
        const cents = parseDollars(text);
        if (cents === null) return void (await wa.sendText(to, "Type the price in US dollars, e.g. *520*."));
        u.draft.priceCents = cents;
        u.draft.priceText = null;
      } else if (id === "price:skip") {
        u.draft.priceText = null;
      } else if (text) {
        u.draft.priceText = clean(text, 40);
      } else return didntGetThat(u);
      return askPhotos(u);
    }
    case "SELL_PHOTOS": {
      if (id === "photos:done" || id === "photos:skip") return askCover(u);
      return didntGetThat(u);
    }
    case "SELL_COVER": {
      if (id !== "cover:city" && id !== "cover:all") return didntGetThat(u);
      u.draft.nationwide = id === "cover:all";
      return sellSummary(u);
    }
    case "SELL_CONFIRM": {
      if (id === "list:post") return createListing(u);
      if (id === "list:cancel") return showMenu(u, "Okay, nothing was listed.");
      return didntGetThat(u);
    }

    // ---- quote
    case "QUOTE_TEXT": {
      if (id === "quote:skip") return submitQuote(u, null);
      if (text) return submitQuote(u, clean(text, 80));
      return didntGetThat(u);
    }

    // ---- advertise
    case "AD_TEXT": {
      if (text.length < 5) return void (await wa.sendText(to, "Please write your ad in a sentence."));
      if (await refusedAsBanned(u, text)) return;
      u.draft.text = clean(text, 120);
      u.draft.photos = [];
      u.step = "AD_PHOTO";
      return prompt(u, () =>
        wa.sendButtons(to, "Send one photo for your ad (your shop, product or logo). Ads with a photo get far more taps.", [{ id: "photos:skip", title: "No photo" }]),
      );
    }
    case "AD_PHOTO": {
      if (id === "photos:skip") return askAdWhere(u);
      return didntGetThat(u);
    }
    case "AD_WHERE": {
      if (id !== "where:city" && id !== "where:any") return didntGetThat(u);
      u.draft.anywhere = id === "where:any";
      return adSummary(u);
    }
    case "AD_CONFIRM": {
      if (id === "ad:submit") return submitAd(u);
      if (id === "ad:cancel") return showMenu(u, "Okay, no ad was created.");
      return didntGetThat(u);
    }

    // ---- buying credits
    case "BUY_PAYER": {
      if (id === "pay:self") {
        const own = toLocalNumber(to);
        if (!networkMatches(own, "ecocash")) return askOtherNumber(u, "This number isn't on EcoCash.");
        return beginPurchase(u, own);
      }
      if (id === "pay:other") return askOtherNumber(u);
      return didntGetThat(u);
    }
    case "BUY_OTHER_NUMBER": {
      const number = normalizeZwMobile(text);
      if (!number) return void (await wa.sendText(to, "That doesn't look like a Zimbabwe mobile number. Please type it like 0771 234 567."));
      if (!networkMatches(number, "ecocash")) return void (await wa.sendText(to, "EcoCash numbers start with 077 or 078. Please type an EcoCash number."));
      return beginPurchase(u, number);
    }
  }
  return didntGetThat(u);
}

// ---------------------------------------------------------------- onboarding & menu

async function askConsent(to: string): Promise<void> {
  await wa.sendButtons(
    to,
    `👋 Welcome to *${env.APP_NAME}*.\n\nTell us what you're looking for and we'll show you who's selling it: cars, fridges, carpenters, mechanics and more. Or sell your own things and services.\n\nBy continuing you agree that:\n• we store your name, town and posts, and only share your number with people you say yes to\n• no illegal goods or services are allowed\n• ${env.APP_NAME} only connects people. We aren't part of any deal and aren't responsible for it.`,
    [
      { id: "consent:yes", title: "I agree" },
      { id: "terms", title: "Read the rules" },
      { id: "consent:no", title: "No thanks" },
    ],
  );
}

async function showTerms(to: string): Promise<void> {
  await wa.sendText(
    to,
    `*${env.APP_NAME} rules*\n\n1. ${env.APP_NAME} only connects buyers and sellers. We don't sell, deliver or guarantee anything, and we aren't responsible for any deal, payment or item.\n2. No illegal goods or services, e.g. drugs, weapons, stolen goods, fake documents, counterfeit goods or protected wildlife. Posts like these are blocked and accounts removed.\n3. Be honest about items and prices. Listings with 3 confirmed reports are paused.\n4. Your number is only shared when both sides agree to swap numbers.\n5. Credits pay for swaps and ads. Credits on hold come back if a swap doesn't happen.\n6. Stay safe: meet in public, check the item or work, and never pay a deposit before you've seen it.\n\nType MENU to continue.`,
  );
}

async function askCity(u: User): Promise<void> {
  u.step = "ASK_CITY";
  await prompt(u, () =>
    wa.sendList(u.phone, "Which town are you in? We show you people nearby first.", "Pick town", CITIES.map((c) => ({ id: `city:${c.key}`, title: c.name })), "Towns"),
  );
}

// ---------------------------------------------------------------- buyer or seller + seller profile

async function askRole(u: User): Promise<void> {
  u.step = "ASK_ROLE";
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `Welcome to ${env.APP_NAME}, ${u.name} 👋 🎁 You have ${WELCOME_CREDITS} free credits.\n\nWhat brings you here?\n\n🔎 *Buying:* tell us what you need and see who's selling it.\n🏷️ *Selling:* list items or services once and buyers come to you.`,
      [
        { id: "role:buy", title: "🔎 I'm buying" },
        { id: "role:sell", title: "🏷️ I'm selling" },
        { id: "role:both", title: "Both" },
      ],
    ),
  );
}

async function startProfile(u: User, intro: string, next: Draft["next"] = "menu"): Promise<void> {
  u.draft = { profile: {}, next };
  u.step = "PROF_NAME";
  const buttons = u.name ? [{ id: "prof:usename", title: fit(`Use "${u.name}"`, 20) }] : [];
  await wa.sendText(u.phone, intro);
  await prompt(u, () =>
    buttons.length
      ? wa.sendButtons(u.phone, "*Step 1 of 3:* What name should people see?\n\nType your business name (e.g. _Sipho Painters_) or tap below to use your own name.", buttons)
      : wa.sendText(u.phone, "*Step 1 of 3:* What name should people see? Type your business name or your own name."),
  );
}

async function askProfileAbout(u: User): Promise<void> {
  u.step = "PROF_ABOUT";
  await prompt(u, () =>
    wa.sendText(
      u.phone,
      "*Step 2 of 3:* Tell people about yourself in one or two sentences: what you do, or what you sell or offer.\n\nFor example: _Used cars and pickups, all papers in order. Based in Bulawayo, delivery anywhere in Zim._ or _Teacher in Bulawayo, buying for my family._",
    ),
  );
}

async function askProfilePhoto(u: User): Promise<void> {
  u.step = "PROF_PHOTO";
  await prompt(u, () =>
    wa.sendText(
      u.phone,
      "*Step 3 of 3:* Send a profile photo 📸\n\nA clear photo of you, your logo, your shop front or your work. People trust profiles with a real photo, so you get far more swaps.\n\nTap 📎 or 📷 to send it.",
    ),
  );
}

async function addProfilePhoto(u: User, mediaId: string): Promise<void> {
  const link = await savePhoto(mediaId);
  if (!link) return void (await wa.sendText(u.phone, "Sorry, that photo didn't come through. Please send it again."));
  u.draft.profile = { ...u.draft.profile, photo: link };
  return previewProfile(u);
}

function profileCard(u: User, p: Profile): string {
  const mine = [...listings.values()].filter((l) => l.owner === u.phone);
  const count = mine.reduce((n, l) => n + l.ratingCount, 0);
  const avg = count ? mine.reduce((n, l) => n + l.ratingSum, 0) / count : 0;
  const rating = count ? `⭐ ${avg.toFixed(1)} (${count})` : "No ratings yet";
  return `*${p.name}*\n📍 ${cityName(u.city)} · ${u.pharmacy ? "💊 Licensed pharmacy" : u.verified ? "✅ Verified" : "🆕 New member"} · ${rating}\n\n${p.about}`;
}

async function previewProfile(u: User): Promise<void> {
  const p = u.draft.profile;
  if (!p?.name || !p.about || !p.photo) return startProfile(u, "Let's finish your profile.");
  u.step = "PROF_CONFIRM";
  const full: Profile = { name: p.name, about: p.about, photo: p.photo };
  await prompt(u, () =>
    wa.sendButtons(u.phone, `This is what people will see:\n\n${profileCard(u, full)}`, [
      { id: "prof:ok", title: "✅ Looks good" },
      { id: "prof:photo", title: "Change photo" },
      { id: "prof:edit", title: "Edit details" },
    ], { imageUrl: full.photo }),
  );
}

async function saveProfile(u: User): Promise<void> {
  const p = u.draft.profile;
  if (!p?.name || !p.about || !p.photo) return startProfile(u, "Let's finish your profile.");
  const first = u.profile === null;
  const next = u.draft.next ?? "menu";
  const keepText = u.draft.text;
  u.profile = { name: p.name, about: p.about, photo: p.photo };
  u.draft = {};
  track("profile_saved", u.phone, { first });
  if (!first) return showMenu(u, "✅ Profile updated.");
  if (next === "sell") {
    await wa.sendText(u.phone, "✅ Your profile is ready. Now let's list your first item or service.");
    return startSell(u);
  }
  if (next === "find") {
    if (keepText) {
      await wa.sendText(u.phone, "✅ Your profile is ready. Here's what we found:");
      return quickFind(u, keepText);
    }
    await wa.sendText(u.phone, "✅ Your profile is ready.");
    u.draft = { mode: "find" };
    return askFindText(u);
  }
  return showMenu(u, "✅ Your profile is ready.");
}

async function showProfile(u: User): Promise<void> {
  if (!u.profile) return startProfile(u, "You don't have a profile yet. Let's set one up. It takes 1 minute.");
  u.step = "MENU";
  await wa.sendButtons(u.phone, `Your profile:\n\n${profileCard(u, u.profile)}`, [
    { id: "menu:sell", title: "🏷️ List something" },
    { id: "prof:redo", title: "Edit profile" },
    { id: "menu:main", title: "Main menu" },
  ], { imageUrl: u.profile.photo });
}

// ---------------------------------------------------------------- pharmacies

async function findMedicine(u: User): Promise<void> {
  u.draft.mode = "find";
  u.draft.kind = "item";
  u.draft.category = "pharmacy";
  await wa.sendText(u.phone, `💊 We'll show you *licensed pharmacies* for this. For prescription medicines, take your prescription with you: the pharmacy must see it before selling.`);
  return createNeed(u);
}

async function askPharmacyDetails(u: User): Promise<void> {
  if (u.pharmacy) return showMenu(u, "💊 You're already approved as a licensed pharmacy. List medicines under *Sell or offer → Pharmacy & medicines*.");
  u.draft = {};
  u.step = "PHARM_DETAILS";
  await prompt(u, () =>
    wa.sendText(
      u.phone,
      "💊 *Apply as a licensed pharmacy*\n\nOnly licensed pharmacies can list medicines. Send these in *one message*:\n1. Pharmacy name\n2. Physical address\n3. MCAZ premises licence number\n4. Responsible pharmacist's name\n\nDon't include phone numbers; we already have yours.",
    ),
  );
}

async function reviewPharmacy(admin: string, phone: string, approve: boolean): Promise<void> {
  const p = users.get(phone);
  if (!p) return void (await wa.sendText(admin, "That person hasn't messaged the bot."));
  if (approve) {
    p.pharmacy = { details: p.pharmacyApplication ?? "approved by admin", approvedAt: Date.now() };
    p.verified = true;
    track("pharmacy_approved", phone, {});
    await wa.sendText(admin, `✅ ${nameOf(phone)} is now a licensed pharmacy.`);
    await tell(phone, `✅ You're approved as a *licensed pharmacy* on ${env.APP_NAME}. List medicines under *Sell or offer → Pharmacy & medicines*. Your listings show 💊 Licensed pharmacy.`);
  } else {
    p.pharmacy = null;
    await wa.sendText(admin, `Rejected ${nameOf(phone)}'s pharmacy application.`);
    await tell(phone, `Sorry, we couldn't approve your pharmacy application. Reply PHARMACY to apply again with your MCAZ licence details.`);
  }
  p.pharmacyApplication = null;
}

async function showMenu(u: User, greeting: string): Promise<void> {
  u.step = "MENU";
  u.draft = {};
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      `${greeting}\n\nWhat would you like to do? You can also just type what you're looking for.`,
      "Choose",
      [
        { id: "menu:find", title: "🔎 Find something", description: "Items or services. See prices side by side." },
        { id: "menu:sell", title: "🏷️ Sell or offer", description: "List an item or service once. Buyers come to you." },
        { id: "menu:posts", title: "My posts", description: "See, close or mark as sold. Rate people." },
        { id: "menu:profile", title: "🪪 My profile", description: u.profile ? `${fit(u.profile.name, 40)} · tap to view or edit` : "Set it up: name, photo, about you." },
        { id: "menu:credits", title: "My credits", description: `Balance: ${credits(ledger.balance(u.phone))}` },
        { id: "menu:ads", title: "📣 Advertise", description: "Show your business in search results." },
        { id: "menu:city", title: "Change my town", description: `Now: ${cityName(u.city)}` },
        { id: "menu:help", title: "How it works" },
      ],
      env.APP_NAME,
    ),
  );
}

async function showHelp(u: User): Promise<void> {
  await wa.sendText(
    u.phone,
    `*How ${env.APP_NAME} works*\n\n🔎 *Looking for something?* Post it with your budget. Items come back as picture cards, new and pre-loved side by side. For services, providers send you quotes to compare.\n\n🏷️ *Selling?* List it once with photos. Buyers who are looking for it are sent to you. No more posting in groups and hoping.\n\n🤝 *Swapping numbers* happens only when both sides say yes. Each side uses credits (1 for most things, 3 for cars and houses).\n\n🎁 Everyone gets ${WELCOME_CREDITS} free credits. More from ${formatUsd(BUNDLES[0]?.cents ?? 200)}.\n\nType MENU, TERMS or STOP (alerts off) any time.\n\n${LIABILITY}`,
  );
}

// ---------------------------------------------------------------- picking a category

async function askKind(u: User, mode: Mode): Promise<void> {
  u.step = "CAT_KIND";
  u.draft.mode = mode;
  const body =
    mode === "find"
      ? u.draft.text
        ? `Looking for "${fit(u.draft.text, 80)}"? Is it an item or a service?`
        : "What are you looking for: an item or a service?"
      : mode === "sell"
        ? "What would you like to list?"
        : "What do your customers search for: items or services?";
  await prompt(u, () =>
    wa.sendButtons(u.phone, body, [
      { id: "kind:item", title: mode === "sell" ? "Sell an item" : "An item" },
      { id: "kind:service", title: mode === "sell" ? "Offer a service" : "A service" },
    ]),
  );
}

async function askCategory(u: User): Promise<void> {
  u.step = "CAT_PICK";
  const kind = u.draft.kind ?? "item";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      kind === "item" ? "Pick the category. New and pre-loved are both welcome." : "Pick the closest service.",
      "Categories",
      categoriesOf(kind).map((c) => ({ id: `cat:${c.key}`, title: c.name, description: fit(`e.g. ${c.example}`, 72) })),
      kind === "item" ? "Items" : "Services",
    ),
  );
}

// ---------------------------------------------------------------- finding something

async function askFindText(u: User): Promise<void> {
  u.step = "FIND_TEXT";
  const cat = getCategory(u.draft.category ?? "");
  await prompt(u, () =>
    wa.sendText(
      u.phone,
      cat
        ? `Describe what you're looking for in a few words.\n\nFor example: _${cat.example}_`
        : "What are you looking for? Say it all in *one message*: what, budget, and when if it matters.\n\nFor example:\n• _pre-loved fridge, budget $100_\n• _Toyota Vitz under $4,000_\n• _plumber for a leaking geyser today_",
    ),
  );
}

/**
 * One message in, results out: reads the item, budget, timing and town from the text and posts
 * straight away. Only asks for the category if it really can't tell.
 */
async function quickFind(u: User, raw: string): Promise<void> {
  const text = clean(raw, 300);
  const got = understand(text, CITIES);
  const keepCategory = u.draft.category; // picked from the category list before typing
  u.draft = {
    mode: "find",
    text,
    budgetCents: got.budgetCents ?? null,
    budgetText: got.budgetText ?? null,
    when: got.when ?? "flexible",
    whenText: got.whenText ?? null,
    anywhere: got.anywhere ?? false,
    ...(got.city && got.city !== u.city ? { city: got.city } : {}),
  };
  track("search_understood", u.phone, { category: got.category ?? keepCategory ?? "unknown", budget: got.budgetCents !== undefined, when: got.when ?? "none" });
  if (medicineWord(text)) return findMedicine(u);
  const cat = getCategory(keepCategory ?? got.category ?? "");
  if (!cat) return askKind(u, "find");
  u.draft.category = cat.key;
  u.draft.kind = cat.kind;
  return createNeed(u);
}

// ---------------------------------------------------------------- editing a search after the results

async function searchOptions(u: User, need: Need, intro: string): Promise<void> {
  await wa.sendButtons(u.phone, intro, [
    { id: `alert:on:${need.id}`, title: "🔔 Alert me" },
    { id: `edit:menu:${need.id}`, title: "✏️ Edit search" },
    { id: "menu:credits", title: "💳 My credits" },
  ]);
}

async function editMenu(u: User, needId: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone || need.status !== "OPEN") return showMenu(u, "That search has closed. Type what you're looking for to start a new one.");
  const rows = [
    ...(need.kind === "item" ? [{ id: `edit:budget:${need.id}`, title: "💵 Change budget", description: budgetOf(need) ? `Now: ${budgetOf(need)}` : "Now: not set" }] : []),
    need.anywhere
      ? { id: `edit:here:${need.id}`, title: fit(`📍 Only ${cityName(need.city)}`, 24), description: "Now: anywhere in Zimbabwe" }
      : { id: `edit:any:${need.id}`, title: "📍 Search all of Zim", description: `Now: ${cityName(need.city)} only` },
    { id: `edit:cat:${need.id}`, title: "🏷️ Wrong category?", description: `Now: ${catName(need.category)}` },
    { id: "menu:find", title: "🔁 New search" },
    { id: "menu:main", title: "Main menu" },
  ];
  await wa.sendList(u.phone, `Change your search "${fit(need.text, 50)}":`, "Options", rows, "Edit search");
}

/** Closes the old search and runs it again with the change. Held credits on the old one come back. */
async function editSearch(u: User, needId: string, what: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone || need.status !== "OPEN") return showMenu(u, "That search has closed. Type what you're looking for to start a new one.");
  const base: Draft = {
    mode: "find",
    kind: need.kind,
    category: need.category,
    text: need.text,
    budgetCents: need.budgetCents,
    budgetText: need.budgetText,
    when: need.when,
    whenText: need.whenText,
    anywhere: need.anywhere,
    ...(need.city !== u.city ? { city: need.city } : {}),
    editing: need.id,
  };
  track("search_edited", u.phone, { what });
  if (what === "budget") {
    u.draft = base;
    u.step = "FIND_BUDGET";
    return prompt(u, () => wa.sendButtons(u.phone, "Type your new budget, e.g. _$150_.", [{ id: "budget:skip", title: "No budget" }]));
  }
  if (what === "cat") {
    u.draft = { ...base, category: undefined };
    return askKind(u, "find");
  }
  u.draft = { ...base, anywhere: what === "any" };
  return createNeed(u);
}

async function askBudget(u: User): Promise<void> {
  u.step = "FIND_BUDGET";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "What's your budget? Type an amount, e.g. _$5_ or _$3,000_.\n\nA budget gets you better replies: sellers know you're serious.", [
      { id: "budget:skip", title: "Not sure yet" },
    ]),
  );
}

async function askWhen(u: User): Promise<void> {
  u.step = "FIND_WHEN";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      "When do you need it?",
      "Choose",
      [
        { id: "when:today", title: "Today" },
        { id: "when:week", title: "This week" },
        { id: "when:date", title: "Pick a date & time", description: "For bookings, events, appointments" },
        { id: "when:flexible", title: "Flexible" },
      ],
      "When",
    ),
  );
}

async function askWhere(u: User): Promise<void> {
  u.step = "FIND_WHERE";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Where should we look?", [
      { id: "where:city", title: fit(`In ${cityName(u.city)}`, 20) },
      { id: "where:any", title: "Anywhere in Zim" },
    ]),
  );
}

function whenLabel(d: { when?: WhenKey; whenText?: string | null }): string {
  return d.when === "date" && d.whenText ? d.whenText : WHEN_LABEL[d.when ?? "flexible"];
}

async function findSummary(u: User): Promise<void> {
  u.step = "FIND_CONFIRM";
  const d = u.draft;
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `*Check your post*\n\n🔎 "${d.text}"\n🏷️ ${catName(d.category ?? "")}\n💵 Budget: ${d.budgetText ?? "not sure yet"}\n⏱ ${whenLabel(d)}\n📍 ${d.anywhere ? "Anywhere in Zimbabwe" : cityName(u.city)}\n\nYour number stays private until you choose to swap.`,
      [
        { id: "need:post", title: "Post it" },
        { id: "need:cancel", title: "Cancel" },
      ],
    ),
  );
}

async function createNeed(u: User): Promise<void> {
  const d = u.draft;
  const cat = getCategory(d.category ?? "");
  if (!cat || !d.text || !u.city) return showMenu(u, "Something went missing. Let's start again.");
  if (d.editing) {
    const old = needs.get(d.editing);
    if (old && old.owner === u.phone && old.status === "OPEN") await closeNeed(old, "CLOSED");
  }
  const need: Need = {
    id: `N-${++needSeq}`,
    owner: u.phone,
    kind: cat.kind,
    category: cat.key,
    city: d.city ?? u.city,
    anywhere: d.anywhere ?? false,
    text: d.text,
    budgetText: d.budgetText ?? null,
    budgetCents: d.budgetCents ?? null,
    when: d.when ?? "flexible",
    whenText: d.whenText ?? null,
    alert: false,
    createdAt: Date.now(),
    status: "OPEN",
    connections: 0,
  };
  needs.set(need.id, need);
  u.draft = {};
  u.step = "MENU";
  u.reprompt = null;
  console.log(`[NEED] ${need.id} posted (${need.category})`);
  track("post_created", u.phone, { category: need.category, kind: need.kind, has_budget: need.budgetCents !== null, anywhere: need.anywhere, dated: need.when === "date" });
  if (need.kind === "item") return showItemCards(u, need);
  return sendToProviders(u, need);
}

/** Picks one live sponsored card for this search, if any. Rotates by fewest views. */
function pickAd(category: string, city: string): Ad | null {
  const ad = [...ads.values()]
    .filter((a) => a.status === "LIVE" && a.category === category && (a.city === null || a.city === city) && ledger.balance(a.owner) >= AD_TAP_COST)
    .sort((x, y) => x.views - y.views)[0];
  if (ad) ad.views += 1;
  return ad ?? null;
}

async function showItemCards(u: User, need: Need): Promise<void> {
  const found = rankItems({ ...need, kind: "item" }, [...listings.values()].filter((l) => l.kind === "item"), CARDS_PER_RESULT);
  const ad = pickAd(need.category, need.city);
  const cost = costOf(need.category);
  track(found.length ? "cards_shown" : "post_no_match", u.phone, { category: need.category, count: found.length, sponsored: Boolean(ad) });

  if (found.length === 0) {
    if (ad) await sendAdCard(u.phone, ad);
    return searchOptions(
      u,
      need,
      `🔎 ${searchLine(need)}\n\nNobody is selling this ${need.anywhere ? "on Scoutly" : `in ${cityName(need.city)}`} yet. Tap *Alert me* and we'll message you as soon as someone lists it.`,
    );
  }

  const cards: CarouselCard[] = found.map((l) => ({
    imageUrl: cardImage(l),
    text: cardText(l),
    buttons: [{ id: `int:${l.id}:${need.id}`, title: "I'm interested" }],
  }));
  if (ad) cards.push({ imageUrl: ad.photo ?? demoPhoto("no-photo.jpg"), text: `Sponsored\n${fit(ad.text, 140)}`, buttons: [{ id: `adtap:${ad.id}`, title: "Contact them" }] });

  const intro = `${found.length} ${found.length === 1 ? "match" : "matches"} for "${fit(need.text, 50)}", best matches first. Swipe to compare 👉`;
  let sent = false;
  if (cards.length >= 2) sent = await wa.sendCarousel(u.phone, intro, cards);
  if (!sent) {
    // Backup: one picture card per listing (works everywhere). Max 5 to keep the chat tidy.
    if (cards.length >= 2) {
      console.warn("[WA] carousel refused, sending single picture cards instead");
      await wa.sendText(u.phone, intro.replace(" Swipe to compare 👉", ""));
    }
    sent = true;
    for (const c of cards.slice(0, 5)) {
      if (!(await wa.sendButtons(u.phone, c.text, c.buttons, { imageUrl: c.imageUrl }))) {
        sent = false;
        break;
      }
    }
  }
  if (!sent) {
    await wa.sendList(
      u.phone,
      intro.replace(" Swipe to compare 👉", " Tap one:"),
      "See matches",
      found.slice(0, 10).map((l) => ({ id: `int:${l.id}:${need.id}`, title: fit(l.title, 24), description: fit(`${priceLabel(l)} · ${l.condition ? CONDITION_LABEL[l.condition] : ""} · ${badges(l)}`, 72) })),
      "Matches",
    );
  }
  await searchOptions(
    u,
    need,
    `🔎 ${searchLine(need)}\n\nTap *I'm interested* on a card and we'll ask the seller. Swapping numbers uses ${credits(cost)} (you have ${ledger.balance(u.phone)}).`,
  );
}

/** One line showing what we understood, so people can spot a wrong guess: category · budget · town. */
function searchLine(need: Need): string {
  return [catName(need.category), budgetOf(need) ? `up to ${budgetOf(need)}` : null, need.when !== "flexible" ? whenLabel(need) : null, need.anywhere ? "anywhere in Zim" : cityName(need.city)]
    .filter(Boolean)
    .join(" · ");
}

async function sendAdCard(to: string, ad: Ad): Promise<void> {
  await wa.sendButtons(to, `📣 *Sponsored*\n${ad.text}`, [{ id: `adtap:${ad.id}`, title: "Contact them" }], ad.photo ? { imageUrl: ad.photo } : {});
}

async function sendToProviders(u: User, need: Need): Promise<void> {
  const matches = rankProviders({ ...need, kind: "service" }, [...listings.values()].filter((l) => l.kind === "service"), new Set(), LEADS_PER_NEED);
  const people = getCategory(need.category)?.people ?? "people";
  const ad = pickAd(need.category, need.city);
  track(matches.length ? "leads_sent" : "post_no_match", u.phone, { category: need.category, count: matches.length });
  if (matches.length === 0) {
    await wa.sendText(u.phone, `✅ Posted (${need.id}).\n\nNo ${people} ${need.anywhere ? "on Scoutly" : `in ${cityName(need.city)}`} are listed yet. Your post stays open for 7 days, and we'll send it to anyone who joins.`);
  } else {
    await wa.sendText(
      u.phone,
      `✅ Posted (${need.id}).\n\nWe've sent it to ${plural(matches.length, "provider")} (${people}). Their quotes will arrive here, and you choose who to swap numbers with. Your number stays private until then.`,
    );
  }
  if (ad) await sendAdCard(u.phone, ad);
  for (const l of matches) await createProviderLead(need, l);
  if (matches.length === 0) await searchOptions(u, need, `🔎 ${searchLine(need)}\n\nTap *Alert me* to hear when someone joins, or *Edit search* if we got something wrong.`);
}

// ---------------------------------------------------------------- selling something

async function startSell(u: User): Promise<void> {
  if (!u.profile) return startProfile(u, "Before you list, let's set up your profile. People see it before they swap numbers with you. It takes 1 minute.", "sell");
  if (activeListingsOf(u.phone).length >= MAX_ACTIVE_LISTINGS) {
    await wa.sendText(u.phone, `You already have ${MAX_ACTIVE_LISTINGS} active listings. Mark one as sold or pause it in *My posts* to add another.`);
    return showMenu(u, "Main menu");
  }
  return askKind(u, "sell");
}

async function askSellTitle(u: User): Promise<void> {
  u.step = "SELL_TITLE";
  await prompt(u, () => wa.sendText(u.phone, "What are you selling? Name it in a few words.\n\nFor example: _Defy combi fridge 250L_ or _Toyota Vitz 2010_"));
}

async function askSellDesc(u: User): Promise<void> {
  u.step = "SELL_DESC";
  if (u.draft.kind === "service") {
    return prompt(u, () =>
      wa.sendText(u.phone, "Describe your service in one or two lines. Buyers see this.\n\nFor example: _Carpenter. Wardrobes, doors, kitchen units. 10 years' experience._"),
    );
  }
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Add a short description: size, model, condition, anything buyers should know.\n\nFor example: _Silver, A+ energy, boxed with warranty._", [
      { id: "desc:skip", title: "Skip" },
    ]),
  );
}

async function askCondition(u: User): Promise<void> {
  u.step = "SELL_COND";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Is it new or pre-loved?", [
      { id: "cond:new", title: "New" },
      { id: "cond:good", title: "Pre-loved: good" },
      { id: "cond:used", title: "Pre-loved: used" },
    ]),
  );
}

async function askPrice(u: User): Promise<void> {
  u.step = "SELL_PRICE";
  if (u.draft.kind === "item") return prompt(u, () => wa.sendText(u.phone, "What's your price in US dollars? e.g. *520*"));
  await prompt(u, () =>
    wa.sendButtons(u.phone, "What's your starting price? e.g. _From $15 call-out_. Or tap Skip.", [{ id: "price:skip", title: "Skip" }]),
  );
}

async function askPhotos(u: User): Promise<void> {
  u.step = "SELL_PHOTOS";
  u.draft.photos = u.draft.photos ?? [];
  const what = u.draft.kind === "item" ? "it" : "your past work";
  await prompt(u, () =>
    wa.sendButtons(u.phone, `📸 Send up to 3 photos of ${what} now. Listings with photos get far more interest.\n\nTap *Done* when you've sent them.`, [
      { id: "photos:done", title: "Done" },
      { id: "photos:skip", title: "No photos" },
    ]),
  );
}

async function addListingPhoto(u: User, mediaId: string): Promise<void> {
  const photos = (u.draft.photos = u.draft.photos ?? []);
  if (photos.length >= 3) return askCover(u);
  const link = await savePhoto(mediaId);
  if (!link) return void (await wa.sendText(u.phone, "Sorry, that photo didn't come through. Please send it again."));
  photos.push(link);
  if (photos.length >= 3) {
    await wa.sendText(u.phone, "📸 3 photos saved.");
    return askCover(u);
  }
  await wa.sendButtons(u.phone, `📸 Photo ${photos.length} saved. Send another, or tap Done.`, [{ id: "photos:done", title: "Done" }]);
}

async function askCover(u: User): Promise<void> {
  u.step = "SELL_COVER";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Who can buy from you?", [
      { id: "cover:city", title: fit(`Only ${cityName(u.city)}`, 20) },
      { id: "cover:all", title: "All of Zimbabwe" },
    ]),
  );
}

async function sellSummary(u: User): Promise<void> {
  u.step = "SELL_CONFIRM";
  const d = u.draft;
  const isItem = d.kind === "item";
  const price = isItem ? dollars(d.priceCents ?? 0) : d.priceText ?? "No price shown";
  const score = profileScore({ photos: d.photos?.length ?? 0, text: d.text ?? "", hasPrice: isItem || Boolean(d.priceText), verified: u.verified });
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `*Check your listing*\n\n${isItem ? `🏷️ ${d.title}` : `👤 ${u.name}`}\n${catName(d.category ?? "")}${d.condition ? ` · ${CONDITION_LABEL[d.condition]}` : ""}\n💵 ${price}\n📸 ${plural(d.photos?.length ?? 0, "photo")}\n📍 ${d.nationwide ? "All of Zimbabwe" : cityName(u.city)}${d.text ? `\n"${fit(d.text, 200)}"` : ""}\n\n📈 Listing score: ${score.score}%${score.tip ? `. ${score.tip}` : ""}`,
      [
        { id: "list:post", title: "List it" },
        { id: "list:cancel", title: "Cancel" },
      ],
      d.photos?.[0] ? { imageUrl: d.photos[0] } : {},
    ),
  );
}

async function createListing(u: User): Promise<void> {
  const d = u.draft;
  const cat = getCategory(d.category ?? "");
  if (!cat || !u.city || d.nationwide === undefined || (cat.kind === "item" && (!d.title || d.priceCents == null))) {
    return showMenu(u, "Something went missing. Let's start again.");
  }
  const l: Listing = {
    id: `O-${++listingSeq}`,
    owner: u.phone,
    kind: cat.kind,
    category: cat.key,
    city: u.city,
    nationwide: d.nationwide,
    title: cat.kind === "item" ? d.title ?? "" : `${u.name ?? "Provider"} · ${cat.name}`,
    text: d.text ?? "",
    priceCents: cat.kind === "item" ? d.priceCents ?? null : null,
    priceText: cat.kind === "service" ? d.priceText ?? null : null,
    condition: d.condition ?? null,
    photos: d.photos ?? [],
    active: true,
    sold: false,
    ratingSum: 0,
    ratingCount: 0,
    jobs: 0,
    strikes: 0,
    sample: false,
    sampleQuote: null,
    createdAt: Date.now(),
  };
  listings.set(l.id, l);
  u.draft = {};
  u.step = "MENU";
  u.reprompt = null;
  console.log(`[LISTING] ${l.id} listed (${l.category})`);
  track("listing_created", u.phone, { category: l.category, kind: l.kind, condition: l.condition, photos: l.photos.length, nationwide: l.nationwide });
  await wa.sendText(
    u.phone,
    `✅ *You're listed* (${l.id})\n\nWhen someone ${l.kind === "item" ? "looks for this" : "posts a matching job"}, it comes to you here. No more posting in groups and hoping.\n\nYou have ${credits(ledger.balance(u.phone))}. A swap uses ${credits(cat.swapCost)}, only when you accept.`,
  );

  // Open posts from before this listing existed.
  const open = [...needs.values()]
    .filter((n) => n.status === "OPEN" && n.connections < MAX_CONNECTIONS_PER_NEED && eligible({ ...n, kind: getCategory(n.category)?.kind }, l))
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, 5);
  if (l.kind === "item") {
    for (const n of open.filter((x) => x.alert)) {
      track("alert_sent", n.owner, { category: n.category });
      await wa.sendButtons(
        n.owner,
        `🔔 *New match* for your post "${fit(n.text, 40)}"\n\n${cardText(l)}`,
        [
          { id: `int:${l.id}:${n.id}`, title: "I'm interested" },
          { id: `alert:off:${n.id}`, title: "Stop alerts" },
        ],
        { imageUrl: cardImage(l) },
      );
    }
  } else {
    const waiting = open.filter((n) => !leadsFor(n.id).some((x) => x.offerId === l.id) && leadsFor(n.id).length < LEADS_PER_NEED + 2);
    if (waiting.length) await wa.sendText(u.phone, `📬 ${plural(waiting.length, "job")} already waiting for you:`);
    for (const n of waiting) await createProviderLead(n, l);
  }
}

// ---------------------------------------------------------------- items: buyer taps a card

async function buyerInterested(u: User, listingId: string, needId: string | null): Promise<void> {
  const l = listings.get(listingId);
  if (!l || !l.active || l.sold) return void (await wa.sendText(u.phone, "Sorry, that item is no longer available."));
  if (l.owner === u.phone) return void (await wa.sendText(u.phone, "That's your own listing 🙂"));
  const existing = [...leads.values()].find((x) => x.offerId === l.id && x.customer === u.phone && (isOpen(x) || x.status === "CONNECTED"));
  if (existing?.status === "CONNECTED") return void (await wa.sendText(u.phone, `You're already connected with ${nameOf(l.owner)}. Their number is in the chat above.`));
  if (existing) return void (await wa.sendText(u.phone, `We've already asked ${nameOf(l.owner)}. We'll tell you as soon as they reply.`));

  const cost = costOf(l.category);
  const leadId = `L${++leadSeq}`;
  if (!ledger.hold(u.phone, `${leadId}:c`, cost)) {
    u.pendingCard = { listingId, needId };
    track("out_of_credits", u.phone, { role: "buyer", category: l.category });
    await wa.sendButtons(
      u.phone,
      `Swapping numbers for this uses ${credits(cost)}. You have ${credits(ledger.balance(u.phone))}.\n\nBuy credits and we'll ask the seller straight after payment.`,
      [
        { id: "menu:credits", title: "Buy credits" },
        { id: "menu:main", title: "Main menu" },
      ],
    );
    return;
  }
  const lead: Lead = {
    id: leadId, needId, offerId: l.id, provider: l.owner, customer: u.phone, origin: "card", cost, quote: null,
    status: "OFFERED", createdAt: Date.now(), updatedAt: Date.now(), rated: false, reported: false,
  };
  leads.set(lead.id, lead);
  track("interest_sent", u.phone, { category: l.category, condition: l.condition });
  await wa.sendText(u.phone, `👍 We've asked ${nameOf(l.owner)} about the *${fit(l.title, 40)}*. ${credits(cost)} on hold, and they come back if they say no.`);
  if (l.sample) {
    setTimeout(() => void sellerResponds(l.owner, lead.id, true), env.SAMPLE_REPLY_SECONDS * 1000);
    return;
  }
  const need = needId ? needs.get(needId) : undefined;
  await wa.sendButtons(
    l.owner,
    `🙋 *${nameOf(u.phone)} is interested* in your ${fit(l.title, 40)} (${priceLabel(l)})\n💵 Their budget: ${(need && budgetOf(need)) ?? "not given"}\n⏱ ${need ? whenLabel(need) : "Not given"}\n📍 ${cityName(users.get(u.phone)?.city ?? null)}\n\nAccept to swap numbers. Uses ${credits(cost)} (you have ${ledger.balance(l.owner)}).`,
    [
      { id: `sell:yes:${lead.id}`, title: "Accept" },
      { id: `sell:no:${lead.id}`, title: "Decline" },
      { id: `sold:${l.id}`, title: "It's sold" },
    ],
  );
}

async function sellerResponds(to: string, leadId: string, accept: boolean): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.provider !== to || lead.origin !== "card") return void (await tell(to, "That request is no longer available."));
  if (lead.status !== "OFFERED") return void (await tell(to, lead.status === "CONNECTED" ? "You're already connected. Their number is above." : "That request has closed."));
  const l = listings.get(lead.offerId);
  if (!l) return;
  if (!accept) {
    moveLead(lead, "PASSED");
    ledger.release(`${lead.id}:c`);
    await tell(to, "Okay, we've let them know.");
    await wa.sendText(lead.customer, `${nameOf(to)} can't help with the ${fit(l.title, 40)} this time. Your ${credits(lead.cost)} are back.`);
    return;
  }
  if (!ledger.hold(to, lead.id, lead.cost)) {
    const u = users.get(to);
    if (u) u.pendingLeadId = lead.id;
    track("out_of_credits", to, { role: "seller", category: l.category });
    await wa.sendButtons(to, `You need ${credits(lead.cost)} to swap numbers. You have ${credits(ledger.balance(to))}.\n\nBuy credits and we'll swap straight after payment.`, [
      { id: "menu:credits", title: "Buy credits" },
      { id: `sell:no:${lead.id}`, title: "Decline" },
    ]);
    return;
  }
  moveLead(lead, "INTERESTED");
  await connect(lead);
}

// ---------------------------------------------------------------- services: leads and quotes

async function createProviderLead(need: Need, l: Listing): Promise<void> {
  const lead: Lead = {
    id: `L${++leadSeq}`, needId: need.id, offerId: l.id, provider: l.owner, customer: need.owner, origin: "need",
    cost: costOf(need.category), quote: null, status: "OFFERED", createdAt: Date.now(), updatedAt: Date.now(), rated: false, reported: false,
  };
  leads.set(lead.id, lead);
  if (l.sample) {
    setTimeout(() => void sampleQuote(lead.id), env.SAMPLE_REPLY_SECONDS * 1000);
    return;
  }
  await wa.sendButtons(
    lead.provider,
    `📣 *New job · ${catName(need.category)}*\n\n"${need.text}"\n💵 Budget: ${budgetOf(need) ?? "not given"}\n⏱ ${whenLabel(need)}\n📍 ${cityName(need.city)}\n\nSend a quote and we'll show them your profile. You use ${credits(lead.cost)} only if they accept.\nYour balance: ${credits(ledger.balance(lead.provider))}.`,
    [
      { id: `lead:yes:${lead.id}`, title: "Send a quote" },
      { id: `lead:no:${lead.id}`, title: "Not for me" },
    ],
  );
}

async function providerResponds(u: User, leadId: string, yes: boolean): Promise<void> {
  const to = u.phone;
  const lead = leads.get(leadId);
  if (!lead || lead.provider !== to || lead.origin !== "need") return void (await wa.sendText(to, "That job is no longer available."));
  if (lead.status === "INTERESTED") return void (await wa.sendText(to, "You've already sent a quote. We'll tell you when the customer replies."));
  if (lead.status !== "OFFERED") return void (await wa.sendText(to, "This job has closed."));
  const need = lead.needId ? needs.get(lead.needId) : undefined;
  if (!need || need.status !== "OPEN") {
    moveLead(lead, "EXPIRED");
    return void (await wa.sendText(to, "Sorry, the customer has already found someone or closed this post."));
  }
  if (!yes) {
    moveLead(lead, "PASSED");
    return void (await wa.sendText(to, "Okay, we won't send that one again."));
  }
  if (ledger.balance(to) < lead.cost) {
    u.pendingLeadId = lead.id;
    track("out_of_credits", to, { role: "provider", category: need.category });
    await wa.sendButtons(to, `You need ${credits(lead.cost)} to quote. You have ${credits(ledger.balance(to))}.\n\nBuy credits and you can quote straight after payment.`, [
      { id: "menu:credits", title: "Buy credits" },
      { id: `lead:no:${lead.id}`, title: "Not for me" },
    ]);
    return;
  }
  u.quoteLeadId = lead.id;
  u.step = "QUOTE_TEXT";
  await prompt(u, () =>
    wa.sendButtons(to, "💬 Type your price and timing for this job.\n\nFor example: _$850, paint included, 4 days_", [{ id: "quote:skip", title: "No price yet" }]),
  );
}

async function submitQuote(u: User, quote: string | null): Promise<void> {
  const lead = leads.get(u.quoteLeadId ?? "");
  u.quoteLeadId = null;
  u.step = "MENU";
  u.reprompt = null;
  if (!lead || lead.status !== "OFFERED") return void (await wa.sendText(u.phone, "This job has closed."));
  if (!ledger.hold(u.phone, lead.id, lead.cost)) {
    u.pendingLeadId = lead.id;
    return void (await wa.sendButtons(u.phone, `You need ${credits(lead.cost)} to quote.`, [{ id: "menu:credits", title: "Buy credits" }]));
  }
  lead.quote = quote;
  moveLead(lead, "INTERESTED");
  track("quote_sent", u.phone, { has_price: quote !== null });
  await wa.sendText(u.phone, `👍 Quote sent. ${credits(lead.cost)} on hold, and they come back if the customer says no.`);
  await introduceProvider(lead);
}

async function sampleQuote(leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  const need = lead?.needId ? needs.get(lead.needId) : undefined;
  const l = lead ? listings.get(lead.offerId) : undefined;
  if (!lead || !need || !l || lead.status !== "OFFERED" || need.status !== "OPEN") return;
  if (!ledger.hold(lead.provider, lead.id, lead.cost)) return;
  lead.quote = l.sampleQuote;
  moveLead(lead, "INTERESTED");
  await introduceProvider(lead);
}

async function introduceProvider(lead: Lead, again = false): Promise<void> {
  const l = listings.get(lead.offerId);
  const need = lead.needId ? needs.get(lead.needId) : undefined;
  if (!l || !need) return;
  await wa.sendButtons(
    lead.customer,
    `🙋 *${nameOf(l.owner)}* ${again ? "" : "sent a quote "}for "${fit(need.text, 50)}"\n\n💵 *${lead.quote ?? "No price yet: ask when you chat"}*\n${badges(l)}\n🏷️ ${catName(l.category)}${l.priceText ? ` · ${l.priceText}` : ""}\n"${fit(l.text, 150)}"\n\nSwap numbers? Uses ${credits(lead.cost)} (you have ${ledger.balance(lead.customer)}).`,
    [
      { id: `conn:yes:${lead.id}`, title: "Swap numbers" },
      { id: `conn:no:${lead.id}`, title: "No thanks" },
      { id: `report:${lead.id}`, title: "Report" },
    ],
    { ...((l.photos[0] ?? users.get(l.owner)?.profile?.photo) ? { imageUrl: l.photos[0] ?? users.get(l.owner)?.profile?.photo } : {}), ...(l.sample ? { footer: "Sample provider for the demo" } : {}) },
  );
  if (again) return;
  const quotes = leadsFor(need.id).filter((x) => x.status === "INTERESTED" || x.status === "CONNECTED");
  if (quotes.length >= 2) {
    const sorted = [...quotes].sort((x, y) => quoteCents(x.quote) - quoteCents(y.quote));
    await wa.sendList(
      lead.customer,
      `📊 *${quotes.length} quotes so far*, cheapest first. Tap one to see it again.`,
      "Compare quotes",
      sorted.slice(0, 10).map((x) => {
        const p = listings.get(x.offerId);
        return { id: `q:${x.id}`, title: fit(nameOf(x.provider), 24), description: fit(`${x.quote ?? "No price yet"} · ${p ? badges(p) : ""}`, 72) };
      }),
      "Quotes",
    );
  }
}

async function showQuote(to: string, leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== to) return void (await wa.sendText(to, "That's no longer available."));
  if (lead.status === "CONNECTED") return void (await wa.sendText(to, `You're already connected with ${nameOf(lead.provider)}.`));
  if (lead.status !== "INTERESTED") return void (await wa.sendText(to, "That quote is no longer available."));
  await introduceProvider(lead, true);
}

async function customerResponds(to: string, leadId: string, accept: boolean): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== to) return void (await wa.sendText(to, "That's no longer available."));
  if (lead.status === "CONNECTED") return void (await wa.sendText(to, "You're already connected. Their number is in the message above."));
  if (lead.status !== "INTERESTED") return void (await wa.sendText(to, "That's no longer available."));
  const need = lead.needId ? needs.get(lead.needId) : undefined;
  if (need && need.status !== "OPEN") return void (await wa.sendText(to, "This post is closed. Post again from the menu if you still need help."));

  if (!accept) {
    moveLead(lead, "DECLINED");
    ledger.release(lead.id);
    await wa.sendText(to, `Okay. We won't share your number with ${nameOf(lead.provider)}.`);
    await tell(lead.provider, `The customer chose someone else this time. Your ${credits(lead.cost)} are back. Balance: ${credits(ledger.balance(lead.provider))}.`);
    return;
  }
  if (!ledger.isHeld(`${lead.id}:c`) && !ledger.hold(to, `${lead.id}:c`, lead.cost)) {
    const u = users.get(to);
    if (u) u.pendingConnId = lead.id;
    track("out_of_credits", to, { role: "buyer", category: need?.category ?? "" });
    await wa.sendButtons(to, `You need ${credits(lead.cost)} to swap numbers with ${nameOf(lead.provider)}. You have ${credits(ledger.balance(to))}.\n\nBuy credits and we'll swap straight after payment.`, [
      { id: "menu:credits", title: "Buy credits" },
      { id: `conn:no:${lead.id}`, title: "No thanks" },
    ]);
    return;
  }
  await connect(lead);
}

/** Both sides said yes: spend the held credits and send each the other's number. */
async function connect(lead: Lead): Promise<void> {
  if (!moveLead(lead, "CONNECTED")) return;
  ledger.capture(lead.id);
  ledger.capture(`${lead.id}:c`);
  const l = listings.get(lead.offerId);
  const need = lead.needId ? needs.get(lead.needId) : undefined;
  if (l) l.jobs += 1;
  if (need) need.connections += 1;
  console.log(`[CONNECT] ${lead.id} (${lead.origin})`);
  track("numbers_swapped", lead.customer, { category: l?.category ?? "", origin: lead.origin, cost: lead.cost });
  const what = l ? (l.kind === "item" ? `the ${fit(l.title, 40)} (${priceLabel(l)})` : catName(l.category)) : "your post";
  const buyer = nameOf(lead.customer);
  const seller = nameOf(lead.provider);
  const wanted = need && need.when !== "flexible" ? whenLabel(need) : null;
  const budget = need ? budgetOf(need) : null;
  const town = cityName(need?.city ?? users.get(lead.customer)?.city ?? null);

  // The key facts, so neither side has to scroll back: what, price/budget, when, where.
  const deal = [
    `🛍️ ${l ? (l.kind === "item" ? fit(l.title, 60) : catName(l.category)) : "Your post"}${l?.priceCents ? ` · ${priceLabel(l)}` : ""}`,
    need ? `🔎 They asked for: "${fit(need.text, 80)}"` : null,
    budget ? `💵 Budget: ${budget}` : null,
    `⏱ Wanted: ${wanted ?? "flexible"}`,
    `📍 ${town}`,
  ].filter(Boolean).join("\n");

  // Pre-typed first message: the other person sees straight away that this came from Scoutly.
  const item = l ? (l.kind === "item" ? `your ${fit(l.title, 40)}${l.priceCents ? ` (${priceLabel(l)})` : ""}` : `your ${catName(l.category).toLowerCase()} service`) : "your listing";
  const buyerHello = `Hi ${seller}, it's ${buyer} 👋 I found you on Scoutly about ${item}.${wanted ? ` I need it ${wanted.toLowerCase()}.` : ""} Is it still available?`;
  const sellerHello = `Hi ${buyer}, it's ${seller} from Scoutly 👋 about ${need ? `your request "${fit(need.text, 60)}"` : what}. When suits you?`;

  await wa.sendText(
    lead.customer,
    `✅ *You're connected with ${seller}*\n\n${deal}\n\n📞 ${prettyPhone(lead.provider)}\n💬 Tap to chat (we've typed a hello for you): ${chatLink(lead.provider, buyerHello)}\n\nAgree the price before anything changes hands. Meet in a public place, check the item or work, and never pay a deposit before you've seen it.${l?.category === "pharmacy" ? "\n💊 Prescription medicines: take your prescription. The pharmacy must see it before selling." : ""}\n\n${credits(lead.cost)} used. Balance: ${credits(ledger.balance(lead.customer))}.\n${LIABILITY}${l?.sample ? "\n\n(Sample seller for the demo: this number isn't real.)" : ""}`,
  );
  await tell(
    lead.provider,
    `✅ *New customer: ${buyer}* (via Scoutly)\n\n${deal}\n\n📞 ${prettyPhone(lead.customer)}\n💬 Tap to chat (we've typed a hello for you): ${chatLink(lead.customer, sellerHello)}\n\n${credits(lead.cost)} used. Balance: ${credits(ledger.balance(lead.provider))}.\n${LIABILITY}`,
  );
  if (need) {
    if (need.connections >= MAX_CONNECTIONS_PER_NEED) {
      await closeNeed(need, "CLOSED");
      await wa.sendText(lead.customer, `You now have ${MAX_CONNECTIONS_PER_NEED} contacts for this post, so we've closed it to stop more messages. Type MENU to post something new.`);
      return;
    }
    await wa.sendButtons(lead.customer, `Did this find what you needed for "${fit(need.text, 40)}"?`, [
      { id: `found:yes:${need.id}`, title: "Yes, close my post" },
      { id: `found:no:${need.id}`, title: "Still looking" },
    ]);
  }
}

async function foundIt(u: User, needId: string, yes: boolean): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  if (!yes) return void (await wa.sendText(u.phone, "Okay, your post stays open. More replies will come here."));
  if (need.status === "OPEN") await closeNeed(need, "CLOSED");
  track("post_found", u.phone, { category: need.category });
  await anythingElse(u.phone, `🎉 Great! We've closed ${need.id}, so nobody else gets it. Rate them later in *My posts*.\n\nAnything else we can help you with?`);
}

/** Closes a need and ends its open leads, returning any held credits. */
async function closeNeed(need: Need, status: "CLOSED" | "EXPIRED"): Promise<void> {
  need.status = status;
  for (const lead of leadsFor(need.id)) {
    if (!isOpen(lead)) continue;
    const wasInterested = lead.status === "INTERESTED";
    moveLead(lead, "EXPIRED");
    ledger.release(`${lead.id}:c`);
    if (ledger.release(lead.id) && wasInterested) await tell(lead.provider, `The post "${fit(need.text, 50)}" has closed. Your held credits are back.`);
  }
}

async function setAlert(u: User, needId: string, on: boolean): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  need.alert = on && need.status === "OPEN";
  track(on ? "alert_opt_in" : "alert_opt_out", u.phone, { category: need.category });
  if (on) return anythingElse(u.phone, `🔔 Done. We'll message you when a new match for "${fit(need.text, 40)}" is listed. Type STOP any time to turn alerts off.\n\nAnything else?`);
  return anythingElse(u.phone, "Okay, no alerts for that post. Anything else?");
}

async function stopAlerts(u: User): Promise<void> {
  let n = 0;
  for (const need of needs.values()) {
    if (need.owner === u.phone && need.alert) {
      need.alert = false;
      n += 1;
    }
  }
  await wa.sendText(u.phone, n ? `🔕 Alerts are off for ${plural(n, "post")}. Type MENU to continue.` : "You have no alerts on. Type MENU to continue.");
}

async function reportLead(to: string, leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || (lead.customer !== to && lead.provider !== to)) return void (await wa.sendText(to, "That's no longer available."));
  if (lead.reported) return void (await wa.sendText(to, "Thanks, this has already been reported."));
  lead.reported = true;
  const l = listings.get(lead.offerId);
  if (to === lead.customer && l) {
    l.strikes += 1;
    if (lead.status === "INTERESTED") {
      moveLead(lead, "DECLINED");
      ledger.release(lead.id);
      ledger.release(`${lead.id}:c`);
    }
    if (l.strikes >= 3 && l.active) {
      l.active = false;
      await tell(l.owner, `Your ${env.APP_NAME} listing "${fit(l.title, 40)}" has been paused after several reports. Reply here if you think this is a mistake.`);
    }
    await wa.sendText(to, `Thanks for telling us. We won't share your number with ${nameOf(lead.provider)}, and our team will look into it.`);
  } else {
    await wa.sendText(to, "Thanks for telling us. Our team will look into it.");
  }
  track("reported", to, { category: l?.category ?? "" });
  if (env.ADMIN_PHONE) {
    await wa.sendText(
      env.ADMIN_PHONE,
      `⚠️ *Report* on lead ${lead.id}\nBy: ${to === lead.customer ? "buyer" : "seller"} ${nameOf(to)} ${prettyPhone(to)}\nAbout: ${nameOf(lead.provider)} ${prettyPhone(lead.provider)} · ${l?.id ?? "?"} · strikes ${l?.strikes ?? 0}/3${l && !l.active ? " · PAUSED" : ""}`,
    );
  }
}

// ---------------------------------------------------------------- my posts & ratings

async function showPosts(u: User): Promise<void> {
  const mine = [...needs.values()].filter((n) => n.owner === u.phone).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const mylist = [...listings.values()].filter((l) => l.owner === u.phone).sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  if (!mine.length && !mylist.length) {
    await wa.sendText(u.phone, "You don't have any posts yet.");
    return anythingElse(u.phone);
  }
  const statusWord = { OPEN: "Open", CLOSED: "Closed", EXPIRED: "Expired" };
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      "Your posts and listings. Tap one to see it, close it, mark it as sold or rate someone.",
      "My posts",
      [
        ...mine.map((n) => ({
          id: `post:need:${n.id}`,
          title: fit(`🔎 ${n.text}`, 24),
          description: fit(`${statusWord[n.status]} · ${plural(n.connections, "contact")} · ${catName(n.category)}`, 72),
        })),
        ...mylist.map((l) => ({
          id: `post:list:${l.id}`,
          title: fit(`🏷️ ${l.kind === "item" ? l.title : catName(l.category)}`, 24),
          description: fit(`${l.sold ? "Sold" : l.active ? "Live" : "Paused"} · ${priceLabel(l)} · ${badges(l)}`, 72),
        })),
      ],
      "Posts",
    ),
  );
}

async function showPost(u: User, type: string, postId: string): Promise<void> {
  if (type === "need") {
    const need = needs.get(postId);
    if (!need || need.owner !== u.phone) return didntGetThat(u);
    const connected = leadsFor(need.id).filter((l) => l.status === "CONNECTED");
    const unrated = connected.filter((l) => !l.rated);
    const buttons = [
      ...(unrated.length ? [{ id: `rate:${need.id}`, title: "Rate someone" }] : []),
      ...(need.status === "OPEN" ? [{ id: `close:${need.id}`, title: "Close post" }] : []),
      { id: "menu:main", title: "Main menu" },
    ];
    await wa.sendButtons(
      u.phone,
      `*${need.id}* · ${need.status === "OPEN" ? "Open" : need.status === "CLOSED" ? "Closed" : "Expired"}\n🔎 "${need.text}"\n🏷️ ${catName(need.category)} · 💵 ${budgetOf(need) ?? "no budget"}\n🔔 Alerts ${need.alert ? "on" : "off"}\n🤝 Contacts: ${connected.length ? connected.map((l) => nameOf(l.provider)).join(", ") : "none yet"}`,
      buttons,
    );
    return;
  }
  const l = listings.get(postId);
  if (!l || l.owner !== u.phone) return didntGetThat(u);
  const asked = [...leads.values()].filter((x) => x.offerId === l.id);
  const score = profileScore({ photos: l.photos.length, text: l.text, hasPrice: l.priceCents !== null || Boolean(l.priceText), verified: u.verified });
  const buttons = [
    ...(l.kind === "item" && !l.sold ? [{ id: `sold:${l.id}`, title: "Mark as sold" }] : []),
    ...(!l.sold ? [l.active ? { id: `pause:${l.id}`, title: "Pause" } : { id: `resume:${l.id}`, title: "Turn back on" }] : []),
    { id: "menu:main", title: "Main menu" },
  ];
  await wa.sendButtons(
    u.phone,
    `*${l.id}* · ${l.sold ? "Sold" : l.active ? "Live" : "Paused"}\n🏷️ ${l.kind === "item" ? l.title : catName(l.category)} · ${priceLabel(l)}\n${badges(l)}\n📬 ${plural(asked.length, "buyer")} interested · 🤝 ${plural(l.jobs, "swap")}\n📈 Listing score: ${score.score}%${score.tip ? `. ${score.tip}` : ""}`,
    buttons,
    l.photos[0] ? { imageUrl: l.photos[0] } : {},
  );
}

async function markSold(u: User, listingId: string): Promise<void> {
  const l = listings.get(listingId);
  if (!l || l.owner !== u.phone) return didntGetThat(u);
  if (l.sold) return void (await wa.sendText(u.phone, "That's already marked as sold."));
  l.sold = true;
  l.active = false;
  for (const lead of [...leads.values()].filter((x) => x.offerId === l.id && isOpen(x))) {
    moveLead(lead, "EXPIRED");
    ledger.release(lead.id);
    if (ledger.release(`${lead.id}:c`)) await wa.sendText(lead.customer, `Sorry, the ${fit(l.title, 40)} has just been sold. Your ${credits(lead.cost)} are back.`);
  }
  track("listing_sold", u.phone, { category: l.category });
  await anythingElse(u.phone, `🎉 Marked as sold. Buyers won't see the ${fit(l.title, 40)} any more.\n\nAnything else?`);
}

async function pickWhoToRate(u: User, needId: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  const unrated = leadsFor(need.id).filter((l) => l.status === "CONNECTED" && !l.rated);
  if (!unrated.length) return void (await wa.sendText(u.phone, "You've rated everyone for this post. Thank you!"));
  if (unrated.length === 1 && unrated[0]) return askRatingFor(u, unrated[0].id);
  await wa.sendList(u.phone, "Who do you want to rate?", "Choose", unrated.map((l) => ({ id: `ratepick:${l.id}`, title: fit(nameOf(l.provider), 24) })), "Contacts");
}

async function askRatingFor(u: User, leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== u.phone || lead.status !== "CONNECTED") return didntGetThat(u);
  if (lead.rated) return void (await wa.sendText(u.phone, "You've already rated them. Thank you!"));
  await wa.sendList(
    u.phone,
    `How was ${nameOf(lead.provider)}? Your stars help others choose.`,
    "Rate",
    [5, 4, 3, 2, 1].map((n) => ({ id: `rating:${lead.id}:${n}`, title: `${"★".repeat(n)} ${["", "Bad", "Poor", "Okay", "Good", "Excellent"][n]}` })),
    "Rating",
  );
}

async function saveRating(u: User, leadId: string, stars: number): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== u.phone || lead.status !== "CONNECTED" || !Number.isInteger(stars) || stars < 1 || stars > 5) return didntGetThat(u);
  if (lead.rated) return void (await wa.sendText(u.phone, "You've already rated them. Thank you!"));
  const l = listings.get(lead.offerId);
  if (!l) return;
  lead.rated = true;
  l.ratingSum += stars;
  l.ratingCount += 1;
  track("rated", u.phone, { stars, category: l.category });
  await wa.sendText(u.phone, `Thanks! You gave ${nameOf(l.owner)} ${stars}/5.`);
  await tell(l.owner, `⭐ ${nameOf(u.phone)} rated you ${stars}/5. Your rating is now ${averageRating(l).toFixed(1)} from ${plural(l.ratingCount, "review")}. ${badges(l)}`);
}

async function closeMyNeed(u: User, needId: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  if (need.status !== "OPEN") return void (await wa.sendText(u.phone, "That post is already closed."));
  await closeNeed(need, "CLOSED");
  return showMenu(u, `Closed ${need.id}. You won't get more replies for it.`);
}

async function toggleListing(u: User, listingId: string, on: boolean): Promise<void> {
  const l = listings.get(listingId);
  if (!l || l.owner !== u.phone || l.sold) return didntGetThat(u);
  if (on && l.strikes >= 3) return void (await wa.sendText(u.phone, "This listing was paused after reports. Reply here and our team will review it."));
  if (on && !l.active && activeListingsOf(u.phone).length >= MAX_ACTIVE_LISTINGS) {
    return void (await wa.sendText(u.phone, `You already have ${MAX_ACTIVE_LISTINGS} live listings. Pause another one first.`));
  }
  l.active = on;
  return showMenu(u, on ? `✅ ${l.id} is live again.` : `⏸ ${l.id} is paused. Buyers won't see it.`);
}

// ---------------------------------------------------------------- sponsored ads

async function showAdvertise(u: User): Promise<void> {
  const mine = [...ads.values()].filter((a) => a.owner === u.phone);
  await wa.sendButtons(
    u.phone,
    `📣 *Advertise on ${env.APP_NAME}*\n\nYour ad shows as the last card when people search a category you choose. A paint shop can target "Building & painting", an insurer can target "Cars".\n\nYou pay ${credits(AD_TAP_COST)} only when someone taps to contact you. Every ad is checked before it goes live.${mine.length ? `\n\nYour ads: ${mine.map((a) => `${a.id} ${a.status.toLowerCase()} (${plural(a.taps, "tap")})`).join(", ")}` : ""}`,
    [
      { id: "adnew", title: "Create an ad" },
      { id: "menu:main", title: "Main menu" },
    ],
  );
}

async function askAdText(u: User): Promise<void> {
  u.step = "AD_TEXT";
  await prompt(u, () => wa.sendText(u.phone, "Write your ad in one line (max 120 characters).\n\nFor example: _Ace Paint Centre: Dulux 20L from $95, free delivery in town_"));
}

async function addAdPhoto(u: User, mediaId: string): Promise<void> {
  const link = await savePhoto(mediaId);
  if (!link) return void (await wa.sendText(u.phone, "Sorry, that photo didn't come through. Please send it again."));
  u.draft.photos = [link];
  await wa.sendText(u.phone, "📸 Photo saved.");
  return askAdWhere(u);
}

async function askAdWhere(u: User): Promise<void> {
  u.step = "AD_WHERE";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Where should your ad show?", [
      { id: "where:city", title: fit(`Only ${cityName(u.city)}`, 20) },
      { id: "where:any", title: "All of Zimbabwe" },
    ]),
  );
}

async function adSummary(u: User): Promise<void> {
  u.step = "AD_CONFIRM";
  const d = u.draft;
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `*Check your ad*\n\n📣 ${d.text}\n🎯 Shows to people searching: ${catName(d.category ?? "")}\n📍 ${d.anywhere ? "All of Zimbabwe" : cityName(u.city)}\n💳 ${credits(AD_TAP_COST)} per tap. Your balance: ${credits(ledger.balance(u.phone))}`,
      [
        { id: "ad:submit", title: "Submit ad" },
        { id: "ad:cancel", title: "Cancel" },
      ],
      d.photos?.[0] ? { imageUrl: d.photos[0] } : {},
    ),
  );
}

async function submitAd(u: User): Promise<void> {
  const d = u.draft;
  if (!d.category || !d.text) return showMenu(u, "Something went missing. Let's start again.");
  const autoLive = isAdmin(u.phone) || !env.ADMIN_PHONE;
  const ad: Ad = {
    id: `AD-${++adSeq}`, owner: u.phone, category: d.category, city: d.anywhere ? null : u.city, text: d.text,
    photo: d.photos?.[0] ?? null, status: autoLive ? "LIVE" : "PENDING", views: 0, taps: 0, createdAt: Date.now(),
  };
  ads.set(ad.id, ad);
  track("ad_created", u.phone, { category: ad.category, auto_live: autoLive });
  if (autoLive) return anythingElse(u.phone, `✅ Your ad ${ad.id} is live. Make sure you keep credits: each tap uses ${credits(AD_TAP_COST)}.\n\nAnything else?`);
  await anythingElse(u.phone, `📨 Thanks! Your ad ${ad.id} has been sent for approval. We'll message you when it's live.\n\nAnything else?`);
  if (env.ADMIN_PHONE) {
    await wa.sendButtons(
      env.ADMIN_PHONE,
      `📣 *New ad to approve* (${ad.id})\nFrom: ${nameOf(u.phone)} ${prettyPhone(u.phone)}\n🎯 ${catName(ad.category)} · 📍 ${ad.city ? cityName(ad.city) : "All of Zimbabwe"}\n\n"${ad.text}"`,
      [
        { id: `ad:ok:${ad.id}`, title: "Approve" },
        { id: `ad:no:${ad.id}`, title: "Reject" },
      ],
      ad.photo ? { imageUrl: ad.photo } : {},
    );
  }
}

async function reviewAd(to: string, adId: string, approve: boolean): Promise<void> {
  if (!isAdmin(to)) return void (await wa.sendText(to, "Sorry, I didn't get that. Type MENU to start over."));
  const ad = ads.get(adId);
  if (!ad) return void (await wa.sendText(to, "That ad doesn't exist."));
  if (ad.status !== "PENDING") return void (await wa.sendText(to, `${ad.id} is already ${ad.status.toLowerCase()}.`));
  ad.status = approve ? "LIVE" : "REJECTED";
  track(approve ? "ad_approved" : "ad_rejected", ad.owner, { category: ad.category });
  await wa.sendText(to, `${approve ? "✅ Approved" : "❌ Rejected"} ${ad.id}.`);
  await tell(
    ad.owner,
    approve
      ? `✅ Your ad ${ad.id} is live! It shows when people search ${catName(ad.category)}. Each tap uses ${credits(AD_TAP_COST)}; you have ${credits(ledger.balance(ad.owner))}.`
      : `Sorry, your ad ${ad.id} wasn't approved. Reply here if you'd like to know why.`,
  );
}

async function adTapped(u: User, adId: string): Promise<void> {
  const ad = ads.get(adId);
  if (!ad || ad.status !== "LIVE") return void (await wa.sendText(u.phone, "Sorry, this offer has ended."));
  if (ad.owner === u.phone) return void (await wa.sendText(u.phone, "That's your own ad 🙂"));
  const key = `adtap:${ad.id}:${u.phone}`;
  const firstTap = !ledger.hasSpent(key);
  if (firstTap && !ledger.spend(ad.owner, AD_TAP_COST, key)) {
    ad.status = "PAUSED";
    await tell(ad.owner, `⏸ Your ad ${ad.id} is paused because you're out of credits. Buy credits and reply here to turn it back on.`);
    return void (await wa.sendText(u.phone, "Sorry, this offer isn't available right now."));
  }
  if (firstTap) {
    ad.taps += 1;
    track("sponsored_tap", u.phone, { category: ad.category });
    await tell(ad.owner, `📣 ${nameOf(u.phone)} tapped your ad and has your number. ${credits(AD_TAP_COST)} used. Balance: ${credits(ledger.balance(ad.owner))}.`);
  }
  await wa.sendText(
    u.phone,
    `📣 *${nameOf(ad.owner)}*\n${ad.text}\n📞 ${prettyPhone(ad.owner)}\n💬 Chat now: ${chatLink(ad.owner)}\n\n${LIABILITY}${isSample(ad.owner) ? "\n\n(Sample ad for the demo: this number isn't real.)" : ""}`,
  );
}

// ---------------------------------------------------------------- credits

async function waitingForPayment(to: string): Promise<void> {
  await wa.sendText(to, "We're still waiting for your payment. I'll message you as soon as it goes through.");
}

async function showCredits(u: User): Promise<void> {
  if (u.step === "BUY_WAIT") return waitingForPayment(u.phone);
  u.step = "MENU";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      `💳 You have *${credits(ledger.balance(u.phone))}*.\n\nA number swap uses 1 credit from each side. Held credits come back if a swap doesn't happen. Ads use ${credits(AD_TAP_COST)} per tap.\n\n🎁 Free: everyone gets ${WEEKLY_FREE_CREDITS} credits every Monday. Need more? Buy a bundle:`,
      "Buy credits",
      BUNDLES.map((b) => ({ id: `buy:${b.key}`, title: `${credits(b.credits)} · ${formatUsd(b.cents)}`, description: `${formatUsd(Math.round(b.cents / b.credits))} per credit` })),
      "Bundles",
    ),
  );
}

async function startBuy(u: User, bundleKey: string): Promise<void> {
  const bundle = getBundle(bundleKey);
  if (!bundle) return didntGetThat(u);
  u.draft = { bundle: bundle.key };
  u.step = "BUY_PAYER";
  const own = toLocalNumber(u.phone);
  if (!networkMatches(own, "ecocash")) return askOtherNumber(u);
  await prompt(u, () =>
    wa.sendButtons(u.phone, `Pay *${formatUsd(bundle.cents)}* for ${credits(bundle.credits)} with EcoCash from ${formatLocalNumber(own)}?`, [
      { id: "pay:self", title: "Yes, this number" },
      { id: "pay:other", title: "Another number" },
      { id: "menu:main", title: "Cancel" },
    ]),
  );
}

async function askOtherNumber(u: User, note = ""): Promise<void> {
  u.step = "BUY_OTHER_NUMBER";
  await prompt(u, () => wa.sendText(u.phone, `${note ? `${note} ` : ""}Type the EcoCash number to pay from (e.g. 0771 234 567).`));
}

async function beginPurchase(u: User, payer: string): Promise<void> {
  const bundle = getBundle(u.draft.bundle ?? "");
  if (!bundle) return showMenu(u, "Something went missing. Let's start again.");
  const purchase: Purchase = {
    id: `P-${++purchaseSeq}`, phone: u.phone, credits: bundle.credits, cents: bundle.cents, status: "PENDING", pollUrl: null, simulated: false, startedAt: Date.now(),
  };
  const result = await startPayment(purchase.id, purchase.id, `${env.APP_NAME} ${bundle.credits} credits`, bundle.cents, payer, "ecocash");
  if (!result.ok) {
    await wa.sendText(u.phone, "Sorry, the payment couldn't start. Please try again in a minute.");
    return showCredits(u);
  }
  purchase.pollUrl = result.pollUrl;
  purchase.simulated = result.simulated;
  purchases.set(purchase.id, purchase);
  u.purchaseId = purchase.id;
  u.step = "BUY_WAIT";
  u.draft = {};
  const billed = env.PAYNOW_PAY_PHONE || payer;
  const instruction =
    billed === toLocalNumber(u.phone)
      ? `📲 Check your phone and enter your PIN to approve ${formatUsd(bundle.cents)}.`
      : `📲 We've sent a ${formatUsd(bundle.cents)} request to ${formatLocalNumber(billed)}. Ask them to enter their PIN.`;
  await wa.sendText(u.phone, `${instruction}${result.simulated ? "\n\n(Demo mode: this payment will confirm automatically.)" : ""}`);
  watchPurchase(purchase);
}

function watchPurchase(p: Purchase): void {
  const timer = setInterval(() => {
    if (p.status !== "PENDING") return clearInterval(timer);
    if (Date.now() - p.startedAt > PAYMENT_TIMEOUT_MS) {
      clearInterval(timer);
      void purchaseFailed(p, "The payment wasn't approved in time.");
      return;
    }
    void confirmPurchase(p.id);
  }, p.simulated ? 1000 : 5000);
}

/** Called by the poller and by Paynow's result URL. We always ask Paynow before adding credits. */
export async function confirmPurchase(purchaseId: string): Promise<void> {
  const p = purchases.get(purchaseId);
  if (!p || p.status !== "PENDING") return;
  const state = await checkPayment(p.pollUrl, p.simulated, p.startedAt);
  if (state === "paid") return purchasePaid(p);
  if (state === "failed") return purchaseFailed(p, "The payment was cancelled or didn't go through.");
}

async function purchasePaid(p: Purchase): Promise<void> {
  if (p.status !== "PENDING") return;
  p.status = "PAID";
  ledger.purchase(p.phone, p.credits, p.id);
  console.log(`[PAY] ${p.id} paid (${p.credits} credits)`);
  track("credits_bought", p.phone, { credits: p.credits, cents: p.cents });
  const u = users.get(p.phone);
  if (u) {
    u.step = "MENU";
    u.purchaseId = null;
    u.reprompt = null;
  }
  await wa.sendText(p.phone, `✅ Payment received. +${credits(p.credits)}.\nBalance: *${credits(ledger.balance(p.phone))}*.`);
  if (!u) return;
  // Carry on with whatever was waiting for credits.
  const lead = u.pendingLeadId ? leads.get(u.pendingLeadId) : undefined;
  u.pendingLeadId = null;
  if (lead?.status === "OFFERED") {
    if (lead.origin === "card") return sellerResponds(p.phone, lead.id, true);
    return providerResponds(u, lead.id, true);
  }
  const conn = u.pendingConnId;
  u.pendingConnId = null;
  if (conn && leads.get(conn)?.status === "INTERESTED") return customerResponds(p.phone, conn, true);
  const card = u.pendingCard;
  u.pendingCard = null;
  if (card) return buyerInterested(u, card.listingId, card.needId);
}

async function purchaseFailed(p: Purchase, reason: string): Promise<void> {
  if (p.status !== "PENDING") return;
  p.status = "FAILED";
  const u = users.get(p.phone);
  if (u) {
    u.step = "MENU";
    u.purchaseId = null;
  }
  await wa.sendButtons(p.phone, `❌ ${reason} No money was taken.`, [
    { id: "menu:credits", title: "Try again" },
    { id: "menu:main", title: "Main menu" },
  ]);
}

// ---------------------------------------------------------------- admin

/** "0771234567" / "+263 77 123 4567" → "263771234567". */
function toIntl(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (/^2637\d{8}$/.test(d)) return d;
  if (/^07\d{8}$/.test(d)) return `263${d.slice(1)}`;
  return null;
}

async function adminCommand(to: string, text: string): Promise<void> {
  const [cmd = "", arg1 = "", arg2 = ""] = text.trim().split(/\s+/);
  switch (cmd.toLowerCase()) {
    case "stats":
      return sendStats(to);
    case "lookup":
      return lookup(to, arg1.toUpperCase());
    case "grant": {
      const phone = toIntl(arg1);
      const n = Number(arg2);
      if (!phone || !Number.isInteger(n) || n <= 0 || n > 1000) return void (await wa.sendText(to, "Use: GRANT 0771234567 5"));
      ledger.grant(phone, n, `admin:${Date.now()}:${phone}`);
      await wa.sendText(to, `✅ Gave ${credits(n)} to ${nameOf(phone)} ${prettyPhone(phone)}. Balance: ${ledger.balance(phone)}.`);
      await tell(phone, `🎁 You received ${credits(n)} from ${env.APP_NAME}. Balance: ${credits(ledger.balance(phone))}.`);
      return;
    }
    case "verify": {
      const phone = toIntl(arg1);
      const u = phone ? users.get(phone) : undefined;
      if (!phone || !u) return void (await wa.sendText(to, "Use: VERIFY 0771234567 (they must have messaged the bot first)."));
      u.verified = true;
      await wa.sendText(to, `✅ ${nameOf(phone)} is now verified.`);
      await tell(phone, `✅ You're now a verified seller on ${env.APP_NAME}. Your listings show the ✅ badge.`);
      return;
    }
    case "pharmacy":
    case "unpharmacy": {
      const phone = toIntl(arg1);
      if (!phone || !users.get(phone)) return void (await wa.sendText(to, "Use: PHARMACY 0771234567 to approve, UNPHARMACY 0771234567 to remove."));
      if (cmd.toLowerCase() === "pharmacy") return reviewPharmacy(to, phone, true);
      const p = users.get(phone)!;
      p.pharmacy = null;
      for (const l of listings.values()) if (l.owner === phone && l.category === "pharmacy") l.active = false;
      await wa.sendText(to, `Removed ${nameOf(phone)}'s pharmacy status and paused their medicine listings.`);
      return;
    }
    case "ads": {
      const pending = [...ads.values()].filter((a) => a.status === "PENDING");
      if (!pending.length) return void (await wa.sendText(to, "No ads waiting for approval."));
      for (const ad of pending) {
        await wa.sendButtons(to, `📣 ${ad.id} from ${nameOf(ad.owner)}\n🎯 ${catName(ad.category)}\n"${ad.text}"`, [
          { id: `ad:ok:${ad.id}`, title: "Approve" },
          { id: `ad:no:${ad.id}`, title: "Reject" },
        ], ad.photo ? { imageUrl: ad.photo } : {});
      }
    }
  }
}

async function lookup(to: string, id: string): Promise<void> {
  const person = (phone: string) => `${nameOf(phone)} ${prettyPhone(phone)}`;
  const need = needs.get(id);
  if (need) {
    const ls = leadsFor(need.id);
    return void (await wa.sendText(
      to,
      `🔎 *${need.id}* · ${need.status}\nBy: ${person(need.owner)}\n"${need.text}" · ${catName(need.category)} · 💵 ${need.budgetText ?? "-"}\n\n${ls.map((l) => `${l.id} ${l.status}: ${person(l.provider)}${l.quote ? ` · "${l.quote}"` : ""}`).join("\n") || "No leads yet"}`,
    ));
  }
  const l = listings.get(id);
  if (l) {
    const ls = [...leads.values()].filter((x) => x.offerId === l.id);
    return void (await wa.sendText(
      to,
      `🏷️ *${l.id}* · ${l.sold ? "SOLD" : l.active ? "LIVE" : "PAUSED"}\nBy: ${person(l.owner)}\n${l.title} · ${priceLabel(l)} · strikes ${l.strikes}\n\n${ls.map((x) => `${x.id} ${x.status}: ${person(x.customer)}`).join("\n") || "No buyers yet"}`,
    ));
  }
  const lead = leads.get(id);
  if (lead) return void (await wa.sendText(to, `🤝 *${lead.id}* · ${lead.status} (${lead.origin})\nBuyer: ${person(lead.customer)}\nSeller: ${person(lead.provider)}\nCost: ${credits(lead.cost)} each`));
  await wa.sendText(to, "Not found. Use a post (N-1001), listing (O-501) or lead (L1) number.");
}

async function sendStats(to: string): Promise<void> {
  const all = [...leads.values()];
  const count = (s: Lead["status"]) => all.filter((l) => l.status === s).length;
  const paid = [...purchases.values()].filter((p) => p.status === "PAID");
  const real = [...listings.values()].filter((l) => !l.sample);
  const top = new Map<string, number>();
  for (const n of needs.values()) top.set(n.category, (top.get(n.category) ?? 0) + 1);
  const topText = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${catName(k)} (${v})`).join(", ");
  await wa.sendText(
    to,
    `📊 *${env.APP_NAME} today*\n👥 People: ${[...users.keys()].filter((p) => !isSample(p)).length}\n🔎 Posts: ${needs.size} (${[...needs.values()].filter((n) => n.status === "OPEN").length} open)\n🔥 Top searches: ${topText || "none yet"}\n🏷️ Real listings: ${real.filter((l) => l.active && !l.sold).length} live, ${real.filter((l) => l.sold).length} sold\n📬 Leads: ${all.length} · 🙋 Waiting: ${count("OFFERED") + count("INTERESTED")} · 🤝 Swapped: ${count("CONNECTED")}\n📣 Ads: ${[...ads.values()].filter((a) => a.status === "LIVE").length} live, ${[...ads.values()].filter((a) => a.status === "PENDING").length} waiting, ${[...ads.values()].reduce((s, a) => s + a.taps, 0)} taps\n💳 Credits sold: ${paid.reduce((s, p) => s + p.credits, 0)} (${formatUsd(paid.reduce((s, p) => s + p.cents, 0))})\n\nAdmin commands: STATS · LOOKUP N-1001 · GRANT 0771234567 5 · VERIFY 0771234567 · ADS`,
  );
}

// ---------------------------------------------------------------- housekeeping

setInterval(() => {
  const now = Date.now();
  for (const lead of leads.values()) {
    if (!isStale(lead, now)) continue;
    moveLead(lead, "EXPIRED", now);
    if (ledger.release(`${lead.id}:c`)) void wa.sendText(lead.customer, "A seller didn't reply in 48 hours, so your held credits are back.");
    if (ledger.release(lead.id)) void tell(lead.provider, "A customer didn't reply in 48 hours, so your held credits are back.");
  }
  for (const need of needs.values()) {
    const by = need.status === "OPEN" ? wantedBy(need.when, need.createdAt) : null;
    if (by !== null && now > by) {
      void closeNeed(need, "EXPIRED").then(() =>
        wa.sendText(need.owner, `Your post "${fit(need.text, 50)}" was for ${need.when === "today" ? "today" : "this week"}, so we've closed it and any held credits are back. Still looking? Just type it again.`),
      );
      continue;
    }
    if (need.status === "OPEN" && now - need.createdAt > NEED_TTL_MS) {
      void closeNeed(need, "EXPIRED").then(() => wa.sendText(need.owner, `Your post "${fit(need.text, 50)}" has expired after 7 days. Type MENU to post it again.`));
    }
  }
}, 60 * 1000).unref();
