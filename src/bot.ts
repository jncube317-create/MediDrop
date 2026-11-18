// Scoutly conversation logic.
// People post what they're LOOKING FOR (a need) or what they OFFER / SELL (a listing).
// We send each need to matching providers as a lead. A provider taps Interested,
// the customer sees their profile and chooses whether to swap numbers.
// The provider uses 1 credit only when numbers are actually swapped.
//
// State is kept in memory (fine for the demo; v1 stores it in a database).

import { env } from "./env";
import * as wa from "./wa";
import {
  AREAS,
  BUNDLES,
  CATEGORIES,
  LEADS_PER_NEED,
  MAX_ACTIVE_OFFERS,
  MAX_CONNECTIONS_PER_NEED,
  SAMPLE_PROVIDERS,
  WELCOME_CREDITS,
  WHEN_LABEL,
  fit,
  getArea,
  getBundle,
  getCategory,
  type When,
} from "./data";
import { Ledger } from "./credits";
import { averageRating, pickMatches, score, type OfferLike } from "./match";
import { chatLink, isOpen, isStale, moveLead, prettyPhone, type Lead } from "./leads";
import { formatUsd } from "./money";
import { checkPayment, startPayment } from "./pay";
import { formatLocalNumber, networkMatches, normalizeZwMobile, toLocalNumber } from "./paystatus";

export type Incoming =
  | { from: string; kind: "text"; text: string }
  | { from: string; kind: "reply"; id: string }
  | { from: string; kind: "other" };

type Step =
  | "ASK_CONSENT"
  | "ASK_NAME"
  | "ASK_AREA"
  | "MENU"
  | "NEED_CATEGORY"
  | "NEED_TEXT"
  | "NEED_WHEN"
  | "NEED_CONFIRM"
  | "OFFER_CATEGORY"
  | "OFFER_TEXT"
  | "OFFER_COVER"
  | "OFFER_PRICE"
  | "OFFER_CONFIRM"
  | "BUY_PAYER"
  | "BUY_OTHER_NUMBER"
  | "BUY_WAIT";

interface Draft {
  category?: string;
  text?: string;
  when?: When;
  coversAll?: boolean;
  price?: string | null;
  bundle?: string;
}

interface User {
  phone: string;
  name: string | null;
  area: string | null;
  step: Step;
  draft: Draft;
  changingArea: null | "menu" | "need";
  pendingLeadId: string | null; // lead waiting for a credit top-up
  purchaseId: string | null;
  updatedAt: number;
  reprompt: (() => Promise<unknown>) | null;
}

interface Need {
  id: string;
  owner: string;
  category: string;
  area: string;
  text: string;
  when: When;
  createdAt: number;
  status: "OPEN" | "CLOSED" | "EXPIRED";
  connections: number;
}

interface Offer extends OfferLike {
  name: string;
  price: string | null;
  jobs: number;
  strikes: number;
  sample: boolean;
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
const offers = new Map<string, Offer>();
const leads = new Map<string, Lead>();
const purchases = new Map<string, Purchase>();
const ledger = new Ledger();
let needSeq = 1000;
let offerSeq = 500;
let leadSeq = 0;
let purchaseSeq = 100;

const DRAFT_TIMEOUT_MS = 30 * 60 * 1000;
const NEED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;
const DRAFT_STEPS: Step[] = [
  "NEED_CATEGORY", "NEED_TEXT", "NEED_WHEN", "NEED_CONFIRM",
  "OFFER_CATEGORY", "OFFER_TEXT", "OFFER_COVER", "OFFER_PRICE", "OFFER_CONFIRM",
  "BUY_PAYER", "BUY_OTHER_NUMBER",
];

// ---------------------------------------------------------------- sample providers

function seedSamples(): void {
  if (!env.SAMPLE_PROVIDERS) return;
  for (const p of SAMPLE_PROVIDERS) {
    const id = `O-${++offerSeq}`;
    offers.set(id, {
      id,
      owner: p.phone,
      name: p.name,
      category: p.category,
      area: p.area,
      coversAll: p.coversAll,
      text: p.text,
      price: p.price,
      active: true,
      ratingSum: p.ratingSum,
      ratingCount: p.ratingCount,
      jobs: p.jobs,
      strikes: 0,
      sample: true,
      createdAt: Date.now(),
    });
    ledger.grant(p.phone, 1000, `sample:${p.phone}`);
  }
  console.log(`[DEMO] ${SAMPLE_PROVIDERS.length} sample providers loaded (set SAMPLE_PROVIDERS=false to remove)`);
}
seedSamples();

// ---------------------------------------------------------------- helpers

function user(phone: string): { u: User; timedOut: boolean } {
  let u = users.get(phone);
  if (!u) {
    u = { phone, name: null, area: null, step: "ASK_CONSENT", draft: {}, changingArea: null, pendingLeadId: null, purchaseId: null, updatedAt: Date.now(), reprompt: null };
    users.set(phone, u);
  }
  const timedOut = DRAFT_STEPS.includes(u.step) && Date.now() - u.updatedAt > DRAFT_TIMEOUT_MS;
  u.updatedAt = Date.now();
  return { u, timedOut };
}

const textOf = (m: Incoming) => (m.kind === "text" ? m.text.trim() : "");
const replyId = (m: Incoming) => (m.kind === "reply" ? m.id : "");
const nameOf = (phone: string) => users.get(phone)?.name ?? "A customer";
const areaName = (key: string) => getArea(key)?.name ?? key;
const catName = (key: string) => getCategory(key)?.name ?? key;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isSample = (phone: string) => phone.startsWith("26300");

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

function coverage(o: Pick<Offer, "area" | "coversAll">): string {
  return o.coversAll ? `${areaName(o.area)}, covers all of ${env.CITY}` : areaName(o.area);
}

function ratingLine(o: Offer): string {
  const stars = o.ratingCount ? `⭐ ${averageRating(o).toFixed(1)} (${plural(o.ratingCount, "review")})` : `⭐ New on ${env.APP_NAME}`;
  return `${stars} · ${plural(o.jobs, "job")} via ${env.APP_NAME}`;
}

function activeOffersOf(phone: string): Offer[] {
  return [...offers.values()].filter((o) => o.owner === phone && o.active);
}

function leadsFor(needId: string): Lead[] {
  return [...leads.values()].filter((l) => l.needId === needId);
}

// ---------------------------------------------------------------- entry point

export async function handleIncoming(m: Incoming): Promise<void> {
  if (env.ADMIN_PHONE && m.from === env.ADMIN_PHONE && /^stats$/i.test(textOf(m))) return sendStats(m.from);
  return conversation(m);
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

  // First contact: consent → name → area.
  if (u.step === "ASK_CONSENT") {
    if (id === "consent:yes") {
      console.log(`[CONSENT] ...${to.slice(-4)} agreed at ${new Date().toISOString()} (text v1)`);
      u.step = "ASK_NAME";
      await wa.sendText(to, "Thank you 🙏 What's your first name?");
      return;
    }
    if (id === "consent:no") {
      await wa.sendText(to, `No problem. We need this to connect you with people, so we can't continue without it. Type HI if you change your mind.`);
      return;
    }
    return askConsent(to);
  }
  if (u.step === "ASK_NAME") {
    if (!text) return void (await wa.sendText(to, "Please type your first name."));
    u.name = text.replace(/\s+/g, " ").slice(0, 30);
    return askArea(u);
  }
  if (u.step === "ASK_AREA") {
    const area = id.startsWith("area:") ? getArea(id.slice(5)) : undefined;
    if (!area) return didntGetThat(u);
    const first = u.area === null;
    u.area = area.key;
    if (u.changingArea === "need") {
      u.changingArea = null;
      return needSummary(u);
    }
    u.changingArea = null;
    if (first) return showMenu(u, `Welcome to ${env.APP_NAME}, ${u.name} 👋\n\nTell us what you're looking for and we'll find people near you who offer it. Or list your own skill or goods and get customers.`);
    return showMenu(u, `📍 Area updated to ${area.name}.`);
  }

  // Global text commands.
  if (/^(menu|hi|hello|hey|start)$/i.test(text)) {
    if (u.step === "BUY_WAIT") return void (await wa.sendText(to, "We're still waiting for your payment. I'll message you as soon as it goes through."));
    u.draft = {};
    return showMenu(u, `Hi ${u.name} 👋`);
  }
  if (/^help$/i.test(text)) return showHelp(u);
  if (/^credits?$/i.test(text)) return showCredits(u);

  // Taps on leads and posts work from anywhere: those messages stay in the chat.
  const [kind, a, b] = id.split(":");
  switch (kind) {
    case "lead":
      return providerResponds(to, b ?? "", a === "yes");
    case "conn":
      return customerResponds(to, b ?? "", a === "yes");
    case "report":
      return reportLead(to, a ?? "");
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
    case "pause":
    case "resume":
      return toggleOffer(u, a ?? "", kind === "resume");
  }

  if (u.step === "BUY_WAIT") {
    await wa.sendText(to, "We're still waiting for your payment. I'll message you as soon as it goes through.");
    return;
  }

  if (id.startsWith("buy:")) return startBuy(u, id.slice(4));
  if (id.startsWith("menu:")) {
    u.draft = {};
    switch (id) {
      case "menu:main":
        return showMenu(u, "Main menu");
      case "menu:need":
        return askCategory(u, "need");
      case "menu:offer":
        return startOffer(u);
      case "menu:posts":
        return showPosts(u);
      case "menu:credits":
        return showCredits(u);
      case "menu:area":
        u.changingArea = "menu";
        return askArea(u);
      case "menu:help":
        return showHelp(u);
    }
  }

  switch (u.step) {
    case "MENU": {
      // Typing straight away = "I'm looking for this".
      if (text.length >= 3) {
        u.draft = { text: text.slice(0, 300) };
        return askCategory(u, "need");
      }
      return didntGetThat(u);
    }

    case "NEED_CATEGORY":
    case "OFFER_CATEGORY": {
      const cat = id.startsWith("cat:") ? getCategory(id.slice(4)) : undefined;
      if (!cat) return didntGetThat(u);
      u.draft.category = cat.key;
      if (u.step === "OFFER_CATEGORY") return askOfferText(u);
      if (u.draft.text) return askWhen(u);
      return askNeedText(u);
    }

    case "NEED_TEXT":
    case "OFFER_TEXT": {
      if (text.length < 4) {
        await wa.sendText(to, "Please describe it in a few words.");
        return;
      }
      u.draft.text = text.replace(/\s+/g, " ").slice(0, 300);
      return u.step === "NEED_TEXT" ? askWhen(u) : askCover(u);
    }

    case "NEED_WHEN": {
      const when = id.startsWith("when:") ? (id.slice(5) as When) : null;
      if (!when || !(when in WHEN_LABEL)) return didntGetThat(u);
      u.draft.when = when;
      return needSummary(u);
    }

    case "NEED_CONFIRM": {
      if (id === "need:post") return createNeed(u);
      if (id === "need:cancel") {
        u.draft = {};
        return showMenu(u, "Okay, nothing was posted.");
      }
      if (id === "area:change") {
        u.changingArea = "need";
        return askArea(u);
      }
      return didntGetThat(u);
    }

    case "OFFER_COVER": {
      if (id !== "cover:area" && id !== "cover:all") return didntGetThat(u);
      u.draft.coversAll = id === "cover:all";
      return askPrice(u);
    }

    case "OFFER_PRICE": {
      if (id === "price:skip") u.draft.price = null;
      else if (text) u.draft.price = text.replace(/\s+/g, " ").slice(0, 40);
      else return didntGetThat(u);
      return offerSummary(u);
    }

    case "OFFER_CONFIRM": {
      if (id === "offer:post") return createOffer(u);
      if (id === "offer:cancel") {
        u.draft = {};
        return showMenu(u, "Okay, nothing was listed.");
      }
      return didntGetThat(u);
    }

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
    `👋 Welcome to *${env.APP_NAME}*.\n\nWe connect people who need something with people in ${env.CITY} who offer it: carpenters, mechanics, plumbers, sellers and more.\n\nWe store your name, area and posts. Your number is only shared with people you say yes to. Do you agree?`,
    [
      { id: "consent:yes", title: "I agree" },
      { id: "consent:no", title: "No thanks" },
    ],
  );
}

async function askArea(u: User): Promise<void> {
  u.step = "ASK_AREA";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      `Which part of ${env.CITY} are you in? We use this to find people near you.`,
      "Pick area",
      AREAS.map((a) => ({ id: `area:${a.key}`, title: a.name })),
      "Areas",
    ),
  );
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
        { id: "menu:need", title: "I'm looking for…", description: "Post what you need. We'll find people who offer it." },
        { id: "menu:offer", title: "I offer or sell…", description: "List your skill or goods and get customer leads." },
        { id: "menu:posts", title: "My posts", description: "See, close or pause your posts. Rate people." },
        { id: "menu:credits", title: "My credits", description: `Balance: ${plural(ledger.balance(u.phone), "credit")}` },
        { id: "menu:area", title: "Change my area", description: `Now: ${u.area ? areaName(u.area) : "not set"}` },
        { id: "menu:help", title: "How it works" },
      ],
      env.APP_NAME,
    ),
  );
}

async function showHelp(u: User): Promise<void> {
  await wa.sendText(
    u.phone,
    `*How ${env.APP_NAME} works*\n\n🔎 *Looking for something?* Post it. We send it to people near you who offer it. They send you their profile, and you choose who gets your number.\n\n🛠 *Offer a skill or sell things?* List yourself. Matching jobs come to you here. Tap *Interested*, and if the customer accepts, you swap numbers. That uses 1 credit. If they say no, you use nothing.\n\n🎁 New listings get ${WELCOME_CREDITS} free credits. More from ${formatUsd(BUNDLES[0]?.cents ?? 100)}.\n\nType MENU any time.`,
  );
}

async function askCategory(u: User, mode: "need" | "offer"): Promise<void> {
  u.step = mode === "need" ? "NEED_CATEGORY" : "OFFER_CATEGORY";
  const body =
    mode === "need"
      ? u.draft.text
        ? `Looking for "${fit(u.draft.text, 80)}"? Pick the closest category so we send it to the right people.`
        : "What are you looking for? Pick a category."
      : "What do you offer or sell? Pick a category.";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      body,
      "Categories",
      CATEGORIES.map((c) => ({ id: `cat:${c.key}`, title: c.name, description: fit(`e.g. ${c.example}`, 72) })),
      "Categories",
    ),
  );
}

// ---------------------------------------------------------------- posting a need

async function askNeedText(u: User): Promise<void> {
  u.step = "NEED_TEXT";
  const cat = getCategory(u.draft.category ?? "");
  await prompt(u, () => wa.sendText(u.phone, `Describe what you need in a few words.\n\nFor example: _${cat?.example ?? "what you need"}_`));
}

async function askWhen(u: User): Promise<void> {
  u.step = "NEED_WHEN";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "When do you need it?", [
      { id: "when:today", title: "Today" },
      { id: "when:week", title: "This week" },
      { id: "when:flexible", title: "Flexible" },
    ]),
  );
}

async function needSummary(u: User): Promise<void> {
  u.step = "NEED_CONFIRM";
  const d = u.draft;
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `*Check your post*\n\n🔎 "${d.text}"\n🛠 ${catName(d.category ?? "")}\n📍 ${areaName(u.area ?? "")}\n⏱ ${WHEN_LABEL[d.when ?? "flexible"]}\n\nYour number stays private. People who can help send you their profile, and you choose who gets your number.`,
      [
        { id: "need:post", title: "Post it" },
        { id: "area:change", title: "Change area" },
        { id: "need:cancel", title: "Cancel" },
      ],
    ),
  );
}

async function createNeed(u: User): Promise<void> {
  const d = u.draft;
  if (!d.category || !d.text || !d.when || !u.area) return showMenu(u, "Something went missing. Let's start again.");
  const need: Need = {
    id: `N-${++needSeq}`,
    owner: u.phone,
    category: d.category,
    area: u.area,
    text: d.text,
    when: d.when,
    createdAt: Date.now(),
    status: "OPEN",
    connections: 0,
  };
  needs.set(need.id, need);
  u.draft = {};
  u.step = "MENU";
  u.reprompt = null;
  console.log(`[NEED] ${need.id} posted (${need.category})`);

  const matches = pickMatches(need, [...offers.values()], new Set(), LEADS_PER_NEED);
  const people = getCategory(need.category)?.people ?? "people";
  if (matches.length === 0) {
    await wa.sendText(
      u.phone,
      `✅ Posted (${need.id}).\n\nNo ${people} near you are listed yet. Your post stays open for 7 days, and we'll send it to anyone who joins. You'll hear from us here.`,
    );
  } else {
    await wa.sendText(
      u.phone,
      `✅ Posted (${need.id}).\n\nWe've sent it to ${matches.length} ${matches.length === 1 ? people.replace(/s$/, "") : people} near you. When someone's interested, you'll see their profile here and choose whether to swap numbers.`,
    );
  }
  for (const offer of matches) await createLead(need, offer);
}

// ---------------------------------------------------------------- listing an offer

async function startOffer(u: User): Promise<void> {
  if (activeOffersOf(u.phone).length >= MAX_ACTIVE_OFFERS) {
    await wa.sendText(u.phone, `You already have ${MAX_ACTIVE_OFFERS} active listings. Pause one in *My posts* to add another.`);
    return showMenu(u, "Main menu");
  }
  return askCategory(u, "offer");
}

async function askOfferText(u: User): Promise<void> {
  u.step = "OFFER_TEXT";
  await prompt(u, () =>
    wa.sendText(
      u.phone,
      "Describe what you do or sell, in one or two lines. Customers see this.\n\nFor example: _Carpenter. Wardrobes, doors, kitchen units. 10 years' experience._",
    ),
  );
}

async function askCover(u: User): Promise<void> {
  u.step = "OFFER_COVER";
  await prompt(u, () =>
    wa.sendButtons(u.phone, `Which jobs do you want?\n\nYour area: ${areaName(u.area ?? "")}`, [
      { id: "cover:area", title: "Only my area" },
      { id: "cover:all", title: `All of ${fit(env.CITY, 12)}` },
    ]),
  );
}

async function askPrice(u: User): Promise<void> {
  u.step = "OFFER_PRICE";
  await prompt(u, () =>
    wa.sendButtons(u.phone, "Want to show a starting price? Type it, e.g. _From $15 call-out_. Or tap Skip.", [{ id: "price:skip", title: "Skip" }]),
  );
}

async function offerSummary(u: User): Promise<void> {
  u.step = "OFFER_CONFIRM";
  const d = u.draft;
  await prompt(u, () =>
    wa.sendButtons(
      u.phone,
      `*Check your listing*\n\n👤 ${u.name}\n🛠 ${catName(d.category ?? "")}\n"${d.text}"\n📍 ${coverage({ area: u.area ?? "", coversAll: d.coversAll ?? false })}\n💵 ${d.price ?? "No price shown"}\n\nCustomers see this, with your rating, when you say you're interested in their job.`,
      [
        { id: "offer:post", title: "List me" },
        { id: "offer:cancel", title: "Cancel" },
      ],
    ),
  );
}

async function createOffer(u: User): Promise<void> {
  const d = u.draft;
  if (!d.category || !d.text || d.coversAll === undefined || !u.area) return showMenu(u, "Something went missing. Let's start again.");
  const offer: Offer = {
    id: `O-${++offerSeq}`,
    owner: u.phone,
    name: u.name ?? "Provider",
    category: d.category,
    area: u.area,
    coversAll: d.coversAll,
    text: d.text,
    price: d.price ?? null,
    active: true,
    ratingSum: 0,
    ratingCount: 0,
    jobs: 0,
    strikes: 0,
    sample: false,
    createdAt: Date.now(),
  };
  offers.set(offer.id, offer);
  u.draft = {};
  u.step = "MENU";
  u.reprompt = null;
  const gotWelcome = ledger.welcome(u.phone, WELCOME_CREDITS);
  console.log(`[OFFER] ${offer.id} listed (${offer.category})`);
  await wa.sendText(
    u.phone,
    `✅ *You're listed* (${offer.id})\n🛠 ${catName(offer.category)} · 📍 ${coverage(offer)}\n\nWhen someone posts a matching job, it comes to you here. Tap *Interested* and we'll show them your profile.${gotWelcome ? `\n\n🎁 You got ${WELCOME_CREDITS} free credits. 1 credit = 1 customer number, used only when they accept.` : ""}`,
  );

  // Open needs posted before this listing existed.
  const waiting = [...needs.values()]
    .filter((n) => n.status === "OPEN" && n.connections < MAX_CONNECTIONS_PER_NEED && score(n, offer) !== null)
    .filter((n) => !leadsFor(n.id).some((l) => l.offerId === offer.id))
    .filter((n) => leadsFor(n.id).filter((l) => l.status !== "PASSED" && l.status !== "EXPIRED").length < LEADS_PER_NEED + 2)
    .sort((x, y) => y.createdAt - x.createdAt)
    .slice(0, 5);
  if (waiting.length) await wa.sendText(u.phone, `📬 ${plural(waiting.length, "job")} already waiting for you:`);
  for (const need of waiting) await createLead(need, offer);
}

// ---------------------------------------------------------------- leads

async function createLead(need: Need, offer: Offer): Promise<void> {
  const lead: Lead = {
    id: `L${++leadSeq}`,
    needId: need.id,
    offerId: offer.id,
    provider: offer.owner,
    customer: need.owner,
    status: "OFFERED",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rated: false,
    reported: false,
  };
  leads.set(lead.id, lead);
  if (offer.sample) {
    setTimeout(() => void sampleInterested(lead.id), env.SAMPLE_REPLY_SECONDS * 1000);
    return;
  }
  await sendLeadToProvider(lead);
}

async function sendLeadToProvider(lead: Lead): Promise<void> {
  const need = needs.get(lead.needId);
  if (!need) return;
  const balance = ledger.balance(lead.provider);
  await wa.sendButtons(
    lead.provider,
    `📣 *New lead · ${catName(need.category)}*\n\n"${need.text}"\n📍 ${areaName(need.area)} · ⏱ ${WHEN_LABEL[need.when]}\n\nInterested? We'll show them your profile. You only use 1 credit if they accept and you swap numbers.\n\nYour balance: ${plural(balance, "credit")}.`,
    [
      { id: `lead:yes:${lead.id}`, title: "Interested" },
      { id: `lead:no:${lead.id}`, title: "Not for me" },
    ],
  );
}

async function providerResponds(to: string, leadId: string, interested: boolean): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.provider !== to) return void (await wa.sendText(to, "That lead is no longer available."));
  const need = needs.get(lead.needId);
  if (lead.status === "INTERESTED") return void (await wa.sendText(to, "You've already said you're interested. We'll tell you when the customer replies."));
  if (lead.status !== "OFFERED") return void (await wa.sendText(to, "This lead has closed."));
  if (!need || need.status !== "OPEN") {
    moveLead(lead, "EXPIRED");
    return void (await wa.sendText(to, "Sorry, the customer has already found someone or closed this post."));
  }
  if (!interested) {
    moveLead(lead, "PASSED");
    return void (await wa.sendText(to, "Okay, we won't send that one again."));
  }
  if (!ledger.hold(to, lead.id)) {
    const u = users.get(to);
    if (u) u.pendingLeadId = lead.id;
    await wa.sendButtons(
      to,
      `You need 1 credit to show this customer your profile. You have ${plural(ledger.balance(to), "credit")}.\n\nBuy credits and we'll send your profile straight after payment.`,
      [
        { id: "menu:credits", title: "Buy credits" },
        { id: `lead:no:${lead.id}`, title: "Not for me" },
      ],
    );
    return;
  }
  moveLead(lead, "INTERESTED");
  await wa.sendText(to, "👍 We've sent your profile to the customer. 1 credit is on hold, and you get it back if they say no.");
  await introduceProvider(lead);
}

async function sampleInterested(leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  const need = lead ? needs.get(lead.needId) : undefined;
  if (!lead || !need || lead.status !== "OFFERED" || need.status !== "OPEN") return;
  if (!ledger.hold(lead.provider, lead.id)) return;
  moveLead(lead, "INTERESTED");
  await introduceProvider(lead);
}

async function introduceProvider(lead: Lead): Promise<void> {
  const offer = offers.get(lead.offerId);
  const need = needs.get(lead.needId);
  if (!offer || !need) return;
  await wa.sendButtons(
    lead.customer,
    `🙋 *${offer.name}* can help with "${fit(need.text, 60)}"\n\n🛠 ${catName(offer.category)}\n📍 ${coverage(offer)}\n${ratingLine(offer)}\n"${offer.text}"${offer.price ? `\n💵 ${offer.price}` : ""}\n\nSwap numbers with ${offer.name}?`,
    [
      { id: `conn:yes:${lead.id}`, title: "Swap numbers" },
      { id: `conn:no:${lead.id}`, title: "No thanks" },
      { id: `report:${lead.id}`, title: "Report" },
    ],
    offer.sample ? { footer: "Sample provider for the demo" } : {},
  );
}

async function customerResponds(to: string, leadId: string, accept: boolean): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== to) return void (await wa.sendText(to, "That's no longer available."));
  if (lead.status === "CONNECTED") return void (await wa.sendText(to, "You're already connected. Their number is in the message above."));
  if (lead.status !== "INTERESTED") return void (await wa.sendText(to, "That's no longer available."));
  const need = needs.get(lead.needId);
  const offer = offers.get(lead.offerId);
  if (!need || !offer) return;
  if (need.status !== "OPEN") return void (await wa.sendText(to, "This post is closed. Post again from the menu if you still need help."));

  if (!accept) {
    moveLead(lead, "DECLINED");
    ledger.release(lead.id);
    await wa.sendText(to, `Okay. We won't share your number with ${offer.name}.`);
    await tell(lead.provider, `The customer for "${fit(need.text, 50)}" chose someone else this time. Your credit is back. Balance: ${plural(ledger.balance(lead.provider), "credit")}.`);
    return;
  }

  moveLead(lead, "CONNECTED");
  ledger.capture(lead.id);
  need.connections += 1;
  offer.jobs += 1;
  console.log(`[CONNECT] ${lead.id} need ${need.id} ↔ offer ${offer.id}`);
  await wa.sendText(
    to,
    `✅ *You're connected with ${offer.name}*\n📞 ${prettyPhone(offer.owner)}\n💬 Chat now: ${chatLink(offer.owner)}\n\nAgree the price and timing before any work starts. Never pay a deposit before you've met them and seen the work or item.\n\nWhen it's done, rate them in *My posts*.${offer.sample ? "\n\n(Sample provider: this number isn't real.)" : ""}`,
  );
  await tell(
    lead.provider,
    `✅ *New customer: ${nameOf(to)}*\nLooking for: "${need.text}"\n📍 ${areaName(need.area)} · ⏱ ${WHEN_LABEL[need.when]}\n📞 ${prettyPhone(to)}\n💬 Chat now: ${chatLink(to)}\n\n1 credit used. Balance: ${plural(ledger.balance(lead.provider), "credit")}.`,
  );
  if (need.connections >= MAX_CONNECTIONS_PER_NEED) {
    await closeNeed(need, "CLOSED");
    await wa.sendText(to, `You now have ${MAX_CONNECTIONS_PER_NEED} contacts for this post, so we've closed it to stop more messages. Type MENU to post something new.`);
  }
}

/** Closes a need and ends its open leads, returning any held credits. */
async function closeNeed(need: Need, status: "CLOSED" | "EXPIRED"): Promise<void> {
  need.status = status;
  for (const lead of leadsFor(need.id)) {
    if (!isOpen(lead)) continue;
    const wasInterested = lead.status === "INTERESTED";
    moveLead(lead, "EXPIRED");
    if (wasInterested && ledger.release(lead.id)) {
      await tell(lead.provider, `The post "${fit(need.text, 50)}" has closed. Your held credit is back.`);
    }
  }
}

async function reportLead(to: string, leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || (lead.customer !== to && lead.provider !== to)) return void (await wa.sendText(to, "That's no longer available."));
  if (lead.reported) return void (await wa.sendText(to, "Thanks, this has already been reported."));
  lead.reported = true;
  const offer = offers.get(lead.offerId);
  const need = needs.get(lead.needId);
  if (to === lead.customer && offer) {
    offer.strikes += 1;
    if (lead.status === "INTERESTED") {
      moveLead(lead, "DECLINED");
      ledger.release(lead.id);
    }
    if (offer.strikes >= 3 && offer.active) {
      offer.active = false;
      await tell(offer.owner, `Your ${env.APP_NAME} listing "${fit(offer.text, 40)}" has been paused after several reports. Reply here if you think this is a mistake.`);
    }
    await wa.sendText(to, `Thanks for telling us. We won't share your number with ${offer.name}, and our team will look into it.`);
  } else {
    await wa.sendText(to, "Thanks for telling us. Our team will look into it.");
  }
  if (env.ADMIN_PHONE) {
    await wa.sendText(
      env.ADMIN_PHONE,
      `⚠️ *Report* on lead ${lead.id}\nBy: ${to === lead.customer ? "customer" : "provider"} ...${to.slice(-4)}\nProvider: ${offer?.name ?? "?"} (${offer?.id ?? "?"}) · strikes ${offer?.strikes ?? 0}/3${offer && !offer.active ? " · PAUSED" : ""}\nPost: ${need?.id ?? "?"} · ${catName(need?.category ?? "")}`,
    );
  }
}

// ---------------------------------------------------------------- my posts & ratings

async function showPosts(u: User): Promise<void> {
  const mine = [...needs.values()].filter((n) => n.owner === u.phone).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const listings = [...offers.values()].filter((o) => o.owner === u.phone).slice(0, 3);
  if (!mine.length && !listings.length) {
    await wa.sendText(u.phone, "You don't have any posts yet.");
    return showMenu(u, "Main menu");
  }
  const statusWord = { OPEN: "Open", CLOSED: "Closed", EXPIRED: "Expired" };
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      "Your posts and listings. Tap one to see it, close it or rate someone.",
      "My posts",
      [
        ...mine.map((n) => ({
          id: `post:need:${n.id}`,
          title: fit(`🔎 ${n.text}`, 24),
          description: fit(`${statusWord[n.status]} · ${plural(n.connections, "contact")} · ${catName(n.category)}`, 72),
        })),
        ...listings.map((o) => ({
          id: `post:offer:${o.id}`,
          title: fit(`🛠 ${catName(o.category)}`, 24),
          description: fit(`${o.active ? "Active" : "Paused"} · ${ratingLine(o)}`, 72),
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
    const names = connected.map((l) => offers.get(l.offerId)?.name ?? "?").join(", ");
    const buttons = [
      ...(unrated.length ? [{ id: `rate:${need.id}`, title: "Rate someone" }] : []),
      ...(need.status === "OPEN" ? [{ id: `close:${need.id}`, title: "Close post" }] : []),
      { id: "menu:main", title: "Main menu" },
    ];
    await wa.sendButtons(
      u.phone,
      `*${need.id}* · ${need.status === "OPEN" ? "Open" : need.status === "CLOSED" ? "Closed" : "Expired"}\n🔎 "${need.text}"\n🛠 ${catName(need.category)} · 📍 ${areaName(need.area)}\n🤝 Contacts: ${connected.length ? names : "none yet"}`,
      buttons,
    );
    return;
  }
  const offer = offers.get(postId);
  if (!offer || offer.owner !== u.phone) return didntGetThat(u);
  const sent = [...leads.values()].filter((l) => l.offerId === offer.id);
  await wa.sendButtons(
    u.phone,
    `*${offer.id}* · ${offer.active ? "Active" : "Paused"}\n🛠 ${catName(offer.category)}\n"${offer.text}"\n📍 ${coverage(offer)}\n${ratingLine(offer)}\n📬 ${plural(sent.length, "lead")} received · 💳 ${plural(ledger.balance(u.phone), "credit")}`,
    [
      offer.active ? { id: `pause:${offer.id}`, title: "Pause listing" } : { id: `resume:${offer.id}`, title: "Turn back on" },
      { id: "menu:main", title: "Main menu" },
    ],
  );
}

async function pickWhoToRate(u: User, needId: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  const unrated = leadsFor(need.id).filter((l) => l.status === "CONNECTED" && !l.rated);
  if (!unrated.length) return void (await wa.sendText(u.phone, "You've rated everyone for this post. Thank you!"));
  if (unrated.length === 1 && unrated[0]) return askRatingFor(u, unrated[0].id);
  await wa.sendList(
    u.phone,
    "Who do you want to rate?",
    "Choose",
    unrated.map((l) => ({ id: `ratepick:${l.id}`, title: fit(offers.get(l.offerId)?.name ?? "Provider", 24) })),
    "Contacts",
  );
}

async function askRatingFor(u: User, leadId: string): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== u.phone || lead.status !== "CONNECTED") return didntGetThat(u);
  if (lead.rated) return void (await wa.sendText(u.phone, "You've already rated them. Thank you!"));
  const name = offers.get(lead.offerId)?.name ?? "them";
  await wa.sendList(
    u.phone,
    `How was ${name}? Your rating helps others choose.`,
    "Rate",
    [
      { id: `rating:${lead.id}:5`, title: "★★★★★ Excellent" },
      { id: `rating:${lead.id}:4`, title: "★★★★ Good" },
      { id: `rating:${lead.id}:3`, title: "★★★ Okay" },
      { id: `rating:${lead.id}:2`, title: "★★ Poor" },
      { id: `rating:${lead.id}:1`, title: "★ Bad" },
    ],
    "Rating",
  );
}

async function saveRating(u: User, leadId: string, stars: number): Promise<void> {
  const lead = leads.get(leadId);
  if (!lead || lead.customer !== u.phone || lead.status !== "CONNECTED" || !Number.isInteger(stars) || stars < 1 || stars > 5) return didntGetThat(u);
  if (lead.rated) return void (await wa.sendText(u.phone, "You've already rated them. Thank you!"));
  const offer = offers.get(lead.offerId);
  if (!offer) return;
  lead.rated = true;
  offer.ratingSum += stars;
  offer.ratingCount += 1;
  await wa.sendText(u.phone, `Thanks! You gave ${offer.name} ${stars}/5.`);
  await tell(offer.owner, `⭐ ${nameOf(u.phone)} rated you ${stars}/5. Your rating is now ${averageRating(offer).toFixed(1)} from ${plural(offer.ratingCount, "review")}.`);
}

async function closeMyNeed(u: User, needId: string): Promise<void> {
  const need = needs.get(needId);
  if (!need || need.owner !== u.phone) return didntGetThat(u);
  if (need.status !== "OPEN") return void (await wa.sendText(u.phone, "That post is already closed."));
  await closeNeed(need, "CLOSED");
  return showMenu(u, `Closed ${need.id}. You won't get more replies for it.`);
}

async function toggleOffer(u: User, offerId: string, on: boolean): Promise<void> {
  const offer = offers.get(offerId);
  if (!offer || offer.owner !== u.phone) return didntGetThat(u);
  if (on && offer.strikes >= 3) return void (await wa.sendText(u.phone, "This listing was paused after reports. Reply here and our team will review it."));
  if (on && !offer.active && activeOffersOf(u.phone).length >= MAX_ACTIVE_OFFERS) {
    return void (await wa.sendText(u.phone, `You already have ${MAX_ACTIVE_OFFERS} active listings. Pause another one first.`));
  }
  offer.active = on;
  return showMenu(u, on ? `✅ ${offer.id} is back on. New jobs will come to you.` : `⏸ ${offer.id} is paused. You won't get new jobs for it.`);
}

// ---------------------------------------------------------------- credits

async function showCredits(u: User): Promise<void> {
  if (u.step === "BUY_WAIT") return void (await wa.sendText(u.phone, "We're still waiting for your payment. I'll message you as soon as it goes through."));
  u.step = "MENU";
  await prompt(u, () =>
    wa.sendList(
      u.phone,
      `💳 You have *${plural(ledger.balance(u.phone), "credit")}*.\n\n1 credit = 1 customer number. You only use it when a customer accepts. If they say no, it comes back.`,
      "Buy credits",
      BUNDLES.map((b) => ({
        id: `buy:${b.key}`,
        title: `${plural(b.credits, "credit")} · ${formatUsd(b.cents)}`,
        description: `${formatUsd(Math.round(b.cents / b.credits))} per customer contact`,
      })),
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
    wa.sendButtons(u.phone, `Pay *${formatUsd(bundle.cents)}* for ${plural(bundle.credits, "credit")} with EcoCash from ${formatLocalNumber(own)}?`, [
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
    id: `P-${++purchaseSeq}`,
    phone: u.phone,
    credits: bundle.credits,
    cents: bundle.cents,
    status: "PENDING",
    pollUrl: null,
    simulated: false,
    startedAt: Date.now(),
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
  const u = users.get(p.phone);
  if (u) {
    u.step = "MENU";
    u.purchaseId = null;
    u.reprompt = null;
  }
  await wa.sendText(p.phone, `✅ Payment received. +${plural(p.credits, "credit")}.\nBalance: *${plural(ledger.balance(p.phone), "credit")}*.`);
  const waiting = u?.pendingLeadId;
  if (u && waiting) {
    u.pendingLeadId = null;
    if (leads.get(waiting)?.status === "OFFERED") await providerResponds(p.phone, waiting, true);
  }
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

async function sendStats(to: string): Promise<void> {
  const all = [...leads.values()];
  const count = (s: Lead["status"]) => all.filter((l) => l.status === s).length;
  const paid = [...purchases.values()].filter((p) => p.status === "PAID");
  const real = [...offers.values()].filter((o) => !o.sample);
  await wa.sendText(
    to,
    `📊 *${env.APP_NAME} today*\n👥 People: ${users.size}\n🔎 Open posts: ${[...needs.values()].filter((n) => n.status === "OPEN").length} of ${needs.size}\n🛠 Real listings: ${real.filter((o) => o.active).length} active (${real.length} total)\n📬 Leads sent: ${all.length}\n🙋 Interested: ${count("INTERESTED")} · 🤝 Connected: ${count("CONNECTED")} · ✋ Declined: ${count("DECLINED")}\n💳 Credits sold: ${paid.reduce((s, p) => s + p.credits, 0)} (${formatUsd(paid.reduce((s, p) => s + p.cents, 0))})`,
  );
}

// ---------------------------------------------------------------- housekeeping

setInterval(() => {
  const now = Date.now();
  for (const lead of leads.values()) {
    if (!isStale(lead, now)) continue;
    const wasInterested = lead.status === "INTERESTED";
    moveLead(lead, "EXPIRED", now);
    if (wasInterested && ledger.release(lead.id)) void tell(lead.provider, "A customer didn't reply in 48 hours, so your held credit is back.");
  }
  for (const need of needs.values()) {
    if (need.status === "OPEN" && now - need.createdAt > NEED_TTL_MS) {
      void closeNeed(need, "EXPIRED").then(() =>
        wa.sendText(need.owner, `Your post "${fit(need.text, 50)}" has expired after 7 days. Type MENU to post it again.`),
      );
    }
  }
}, 60 * 1000).unref();
