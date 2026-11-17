// Conversation logic for the demo: customer, pharmacist and driver.
// State is kept in memory (fine for the demo; v1 stores it in Supabase).

import { env } from "./env";
import * as wa from "./wa";
import { ZONES, type ZoneKey, findMedicines, getMedicine, getPharmacy, offersFor, type Medicine } from "./data";
import { formatUsd, orderTotals } from "./money";
import {
  type Order,
  TERMINAL,
  checkDeliveryCode,
  newDeliveryCode,
  statusLabel,
  transition,
} from "./orders";
import { checkPayment, startPayment, type PayMethod } from "./pay";
import { formatLocalNumber, networkMatches, normalizeZwMobile } from "./paystatus";

export type Incoming =
  | { from: string; kind: "text"; text: string }
  | { from: string; kind: "reply"; id: string }
  | { from: string; kind: "image"; mediaId: string }
  | { from: string; kind: "other" };

type Step =
  | "ASK_CONSENT"
  | "ASK_NAME"
  | "ASK_AGE"
  | "MENU"
  | "ASK_MED"
  | "PICK_MED"
  | "PICK_PHARMACY"
  | "PICK_QTY"
  | "PICK_ZONE"
  | "PICK_SUBURB"
  | "ASK_ADDRESS"
  | "ASK_SCRIPT"
  | "WAIT_PHARMACIST"
  | "SUMMARY"
  | "PICK_METHOD"
  | "CONFIRM_PAYER"
  | "ASK_PAYER"
  | "WAIT_PAYMENT"
  | "PAY_FAILED";

interface Session {
  step: Step;
  consent: boolean | null;
  name: string | null;
  medicineId: string | null;
  zone: ZoneKey | null;
  orderId: string | null;
  payMethod: PayMethod | null;
  updatedAt: number;
  reprompt: (() => Promise<unknown>) | null;
}

const sessions = new Map<string, Session>();
const orders = new Map<string, Order>();
let orderSeq = 1040;
let driverOnline = false;
const waitingForDriver: string[] = [];

const CART_TIMEOUT_MS = 30 * 60 * 1000;
const PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;

const EMERGENCY_WORDS = [
  "chest pain", "can't breathe", "cant breathe", "cannot breathe", "not breathing", "unconscious",
  "overdose", "heavy bleeding", "bleeding heavily", "seizure", "suicide", "kill myself", "poisoned",
];
const ADVICE_PHRASES = [
  "what can i take", "what should i take", "what medicine for", "what can i use", "how many should i take",
  "dosage", "dose", "is it safe", "side effect", "which medicine is best",
];

const adminPhone = () => env.ADMIN_PHONE || env.PHARMACIST_PHONE;

function session(phone: string): Session {
  let s = sessions.get(phone);
  if (!s) {
    s = { step: "ASK_CONSENT", consent: null, name: null, medicineId: null, zone: null, orderId: null, payMethod: null, updatedAt: Date.now(), reprompt: null };
    sessions.set(phone, s);
  }
  s.updatedAt = Date.now();
  return s;
}

function currentOrder(s: Session): Order | undefined {
  return s.orderId ? orders.get(s.orderId) : undefined;
}

function textOf(m: Incoming): string {
  return m.kind === "text" ? m.text.trim() : "";
}

function replyId(m: Incoming): string {
  return m.kind === "reply" ? m.id : "";
}

// ---------------------------------------------------------------- entry point

export async function handleIncoming(m: Incoming): Promise<void> {
  if (m.from === env.PHARMACIST_PHONE) return pharmacist(m);
  if (m.from === env.DRIVER_PHONE) return driver(m);
  return customer(m);
}

// ---------------------------------------------------------------- customer

async function prompt(s: Session, fn: () => Promise<unknown>): Promise<void> {
  s.reprompt = fn;
  await fn();
}

async function didntGetThat(to: string, s: Session): Promise<void> {
  await wa.sendText(to, "Sorry, I didn't get that. Type MENU to start over.");
  if (s.reprompt) await s.reprompt();
}

function cancelDraft(to: string, s: Session): void {
  const order = currentOrder(s);
  // Only cancel orders still in the customer's hands. Orders waiting on Paynow or a pharmacist carry on.
  if (order && (order.status === "DRAFT" || order.status === "QUOTED" || order.status === "PAYMENT_FAILED")) {
    transition(order, "CANCELLED", to);
  }
  s.orderId = null;
  s.medicineId = null;
  s.zone = null;
}

async function customer(m: Incoming): Promise<void> {
  const to = m.from;
  const s = session(to);
  const text = textOf(m);
  const id = replyId(m);
  const lower = text.toLowerCase();

  // Safety first, at every step.
  if (text && EMERGENCY_WORDS.some((w) => lower.includes(w))) {
    const numbers = env.EMERGENCY_NUMBERS ? `\nEmergency numbers: ${env.EMERGENCY_NUMBERS}` : "";
    await wa.sendText(to, `🚨 This sounds urgent. Please go to the nearest hospital or call emergency services now.${numbers}`);
    await wa.sendText(adminPhone(), `🚨 EMERGENCY flag from a customer (...${to.slice(-4)}). Please check on them.`);
    return;
  }

  // First contact: consent → name → age confirmation.
  if (s.step === "ASK_CONSENT") {
    if (id === "consent:yes" || id === "consent:no") {
      s.consent = id === "consent:yes";
      if (s.consent) console.log(`[CONSENT] ...${to.slice(-4)} agreed at ${new Date().toISOString()} (text v1)`);
      const order = currentOrder(s);
      if (s.name && order?.needsScript && order.status === "DRAFT") {
        // Came back here mid-order to consent for a prescription.
        if (!s.consent) {
          cancelDraft(to, s);
          return showMenu(to, s, "No problem. Prescription orders need consent, so that order was cancelled.");
        }
        s.step = "ASK_SCRIPT";
        await prompt(s, () => wa.sendText(to, "📄 Thank you. Please send a clear photo of your script."));
        return;
      }
      s.step = "ASK_NAME";
      await wa.sendText(to, s.consent ? "Thank you 🙏 What's your first name?" : "No problem. You can still order non-prescription medicine. What's your first name?");
      return;
    }
    await askConsent(to);
    return;
  }
  if (s.step === "ASK_NAME") {
    if (!text) return void (await wa.sendText(to, "Please type your first name."));
    s.name = text.slice(0, 30);
    s.step = "ASK_AGE";
    await prompt(s, () =>
      wa.sendButtons(to, "Please confirm: I'm 18 or older, or I'm ordering for my child as their parent/guardian.", [
        { id: "age:yes", title: "Yes, I confirm" },
      ]),
    );
    return;
  }
  if (s.step === "ASK_AGE") {
    if (id === "age:yes") return showMenu(to, s, `Welcome to MediDrop, ${s.name} 👋`);
    return didntGetThat(to, s);
  }

  // Global commands.
  if (/^(menu|hi|hello|hey|start)$/i.test(text)) {
    if (s.step === "WAIT_PAYMENT" || s.step === "WAIT_PHARMACIST") {
      await wa.sendText(to, "Your order is still in progress. I'll message you as soon as there's an update.");
    } else {
      cancelDraft(to, s);
    }
    return showMenu(to, s, `Hi ${s.name ?? "there"} 👋`);
  }
  if (/^help$/i.test(text)) {
    await wa.sendText(to, "Commands:\nMENU – main menu\nHELP – this message\n\nUse the buttons to order, track or talk to a pharmacist.");
    return;
  }
  if (text && ADVICE_PHRASES.some((p) => lower.includes(p)) && s.step !== "ASK_ADDRESS") {
    await wa.sendButtons(to, "I can't give medical advice, but a pharmacist can help with that.", [
      { id: "menu:pharmacist", title: "Talk to pharmacist" },
      { id: "menu:main", title: "Main menu" },
    ]);
    return;
  }

  // Menu actions work from anywhere except while paying.
  if (id.startsWith("menu:") && s.step !== "WAIT_PAYMENT") {
    switch (id) {
      case "menu:main":
        cancelDraft(to, s);
        return showMenu(to, s, "Main menu");
      case "menu:order":
      case "menu:rx":
        cancelDraft(to, s);
        s.step = "ASK_MED";
        await prompt(s, () =>
          wa.sendText(
            to,
            id === "menu:rx"
              ? "Which medicine is on your prescription? Type its name (e.g. amoxicillin)."
              : "Type the name of the medicine you need (e.g. panado, cough syrup).",
          ),
        );
        return;
      case "menu:track":
        return showTracking(to);
      case "menu:pharmacist":
        await wa.sendText(to, "A pharmacist will message you here shortly. 💬");
        await wa.sendText(env.PHARMACIST_PHONE, `💬 ${s.name ?? "A customer"} asked to talk to a pharmacist. (In v1 you'll reply from the dashboard; their number stays private.)`);
        return;
    }
  }

  switch (s.step) {
    case "MENU":
      return didntGetThat(to, s);

    case "ASK_MED": {
      if (!text) return didntGetThat(to, s);
      const matches = findMedicines(text);
      if (matches.length === 0) {
        await wa.sendButtons(to, `I couldn't find "${text.slice(0, 40)}".`, [
          { id: "menu:order", title: "Try again" },
          { id: "menu:pharmacist", title: "Talk to pharmacist" },
        ]);
        return;
      }
      const first = matches[0];
      if (matches.length === 1 && first) return showPharmacies(to, s, first);
      s.step = "PICK_MED";
      const rows = matches.slice(0, 10).map((med) => ({
        id: `med:${med.id}`,
        title: med.name,
        description: med.rx ? "Prescription needed" : "No prescription needed",
      }));
      await prompt(s, () => wa.sendList(to, "I found a few matches. Which one?", "Choose medicine", rows, "Medicines"));
      return;
    }

    case "PICK_MED": {
      const med = id.startsWith("med:") ? getMedicine(id.slice(4)) : undefined;
      if (!med) return didntGetThat(to, s);
      return showPharmacies(to, s, med);
    }

    case "PICK_PHARMACY": {
      const med = s.medicineId ? getMedicine(s.medicineId) : undefined;
      const pharmacy = id.startsWith("pharm:") ? getPharmacy(id.slice(6)) : undefined;
      if (!med || !pharmacy) return didntGetThat(to, s);
      const offer = offersFor(med, new Date(), env.IGNORE_HOURS).find((o) => o.pharmacy.id === pharmacy.id);
      if (!offer) {
        await wa.sendText(to, `${pharmacy.name} can't take this order right now. Please pick another pharmacy.`);
        return showPharmacies(to, s, med);
      }
      const order: Order = {
        id: `MD-${++orderSeq}`,
        customer: to,
        customerName: s.name ?? "Customer",
        medicineId: med.id,
        pharmacyId: pharmacy.id,
        qty: 1,
        unitCents: offer.priceCents,
        deliveryCents: 0,
        zone: null,
        suburb: null,
        address: null,
        needsScript: med.rx,
        scriptMediaId: null,
        status: "DRAFT",
        deliveryCode: newDeliveryCode(),
        codeAttempts: 0,
        payment: null,
        paymentAttempts: 0,
        events: [],
        createdAt: Date.now(),
      };
      orders.set(order.id, order);
      s.orderId = order.id;
      s.step = "PICK_QTY";
      await prompt(s, () =>
        wa.sendButtons(
          to,
          `How many?\n(Max ${med.maxQty}. You can also type a number.)`,
          [1, 2, 3].filter((n) => n <= med.maxQty).map((n) => ({ id: `qty:${n}`, title: `${n}` })),
        ),
      );
      return;
    }

    case "PICK_QTY": {
      const order = currentOrder(s);
      const med = order ? getMedicine(order.medicineId) : undefined;
      if (!order || !med) return didntGetThat(to, s);
      const raw = id.startsWith("qty:") ? id.slice(4) : text;
      const qty = Number(raw);
      if (!Number.isInteger(qty) || qty < 1) return didntGetThat(to, s);
      if (qty > med.maxQty) {
        await wa.sendText(to, `Sorry, the most you can order is ${med.maxQty}.`);
        return;
      }
      order.qty = qty;
      return askZone(to, s);
    }

    case "PICK_ZONE": {
      const key = id.startsWith("zone:") ? (id.slice(5) as ZoneKey) : null;
      if (!key || !(key in ZONES)) return didntGetThat(to, s);
      s.zone = key;
      s.step = "PICK_SUBURB";
      const zone = ZONES[key];
      const rows = zone.suburbs.slice(0, 10).map((sub, i) => ({ id: `sub:${i}`, title: sub }));
      await prompt(s, () => wa.sendList(to, `Which suburb? (${zone.label}, delivery ${formatUsd(zone.feeCents)})`, "Choose suburb", rows, "Suburbs"));
      return;
    }

    case "PICK_SUBURB": {
      const order = currentOrder(s);
      const zone = s.zone ? ZONES[s.zone] : undefined;
      const suburb = zone && id.startsWith("sub:") ? zone.suburbs[Number(id.slice(4))] : undefined;
      if (!order || !zone || !suburb) return didntGetThat(to, s);
      order.zone = zone.key;
      order.suburb = suburb;
      order.deliveryCents = zone.feeCents;
      s.step = "ASK_ADDRESS";
      await prompt(s, () => wa.sendText(to, "Type your street address or a landmark (e.g. 12 Moffat Rd, near the green gate)."));
      return;
    }

    case "ASK_ADDRESS": {
      const order = currentOrder(s);
      if (!order || text.length < 3) return didntGetThat(to, s);
      order.address = text.slice(0, 120);
      if (order.needsScript) {
        if (!s.consent) {
          s.step = "ASK_CONSENT";
          await wa.sendText(to, "Prescription orders need your consent to store the script.");
          return askConsent(to);
        }
        s.step = "ASK_SCRIPT";
        await prompt(s, () => wa.sendText(to, "📄 This medicine needs a prescription. Please send a clear photo of your script."));
        return;
      }
      return showSummary(to, s, order);
    }

    case "ASK_SCRIPT": {
      const order = currentOrder(s);
      if (!order || m.kind !== "image") return didntGetThat(to, s);
      order.scriptMediaId = m.mediaId;
      if (!transition(order, "AWAITING_PHARMACIST", to)) return didntGetThat(to, s);
      s.step = "WAIT_PHARMACIST";
      const pharmacy = getPharmacy(order.pharmacyId);
      await wa.sendText(to, `Thanks! A pharmacist at ${pharmacy?.name ?? "the pharmacy"} is checking your script. You'll get a message here shortly.`);
      await sendScriptToPharmacist(order);
      return;
    }

    case "WAIT_PHARMACIST":
      await wa.sendText(to, "A pharmacist is still checking your script. I'll message you as soon as they're done.");
      return;

    case "SUMMARY": {
      const order = currentOrder(s);
      if (!order) return didntGetThat(to, s);
      if (id === "pay:cancel") {
        cancelDraft(to, s);
        return showMenu(to, s, "Order cancelled. Nothing was charged.");
      }
      if (id !== "pay:now") return didntGetThat(to, s);
      return askPayMethod(to, s);
    }

    case "PICK_METHOD": {
      if (id !== "method:ecocash" && id !== "method:onemoney") return didntGetThat(to, s);
      s.payMethod = id.slice(7) as PayMethod;
      return askPayer(to, s);
    }

    case "CONFIRM_PAYER": {
      const order = currentOrder(s);
      const own = ownPayerNumber(to, s.payMethod);
      if (!order || !s.payMethod) return didntGetThat(to, s);
      if (id === "payer:self" && own) return beginPayment(to, s, order, s.payMethod, own);
      if (id === "payer:other") return askOtherPayer(to, s);
      return didntGetThat(to, s);
    }

    case "ASK_PAYER": {
      const order = currentOrder(s);
      if (!order || !s.payMethod) return didntGetThat(to, s);
      const payer = normalizeZwMobile(text);
      if (!payer) {
        await wa.sendText(to, "That doesn't look like a Zimbabwe mobile number. Please type it like 0772 123 456.");
        return;
      }
      if (!networkMatches(payer, s.payMethod)) {
        const hint = s.payMethod === "ecocash" ? "EcoCash numbers start with 077 or 078." : "OneMoney numbers start with 071.";
        await wa.sendText(to, `${formatLocalNumber(payer)} isn't a${s.payMethod === "ecocash" ? "n EcoCash" : " OneMoney"} number. ${hint} Please type another number.`);
        return;
      }
      return beginPayment(to, s, order, s.payMethod, payer);
    }

    case "WAIT_PAYMENT":
      await wa.sendText(to, "We're waiting for your payment. Check your phone and enter your PIN to approve.");
      return;

    case "PAY_FAILED": {
      const order = currentOrder(s);
      if (!order) return didntGetThat(to, s);
      if (id === "pay:now") return askPayMethod(to, s);
      if (id === "pay:cancel") {
        transition(order, "CANCELLED", to);
        s.orderId = null;
        return showMenu(to, s, "Order cancelled. Nothing was charged.");
      }
      return didntGetThat(to, s);
    }
  }
}

async function askConsent(to: string): Promise<void> {
  await wa.sendButtons(
    to,
    "Welcome to MediDrop 💊\n\nMediDrop stores your name, address, orders and any prescriptions you send so we can deliver your medicine. Only the pharmacy you choose sees your prescription. Do you agree?",
    [
      { id: "consent:yes", title: "I agree" },
      { id: "consent:no", title: "No thanks" },
    ],
  );
}

async function showMenu(to: string, s: Session, greeting: string): Promise<void> {
  s.step = "MENU";
  await prompt(s, () =>
    wa.sendList(to, `${greeting}\nWhat would you like to do?`, "Menu", [
      { id: "menu:order", title: "Order medicine", description: "Compare pharmacy prices and order" },
      { id: "menu:rx", title: "Upload prescription", description: "Order medicine that needs a script" },
      { id: "menu:track", title: "Track my order" },
      { id: "menu:pharmacist", title: "Talk to a pharmacist" },
    ], "MediDrop"),
  );
}

async function showPharmacies(to: string, s: Session, med: Medicine): Promise<void> {
  if (!med.deliveryAllowed) {
    await wa.sendText(to, `Sorry, ${med.name} can't be delivered. Please visit a pharmacy.`);
    return;
  }
  const offers = offersFor(med, new Date(), env.IGNORE_HOURS);
  if (offers.length === 0) {
    await wa.sendButtons(to, `No open pharmacy has ${med.name} in stock right now.`, [
      { id: "menu:order", title: "Search again" },
      { id: "menu:pharmacist", title: "Talk to pharmacist" },
    ]);
    return;
  }
  s.medicineId = med.id;
  s.step = "PICK_PHARMACY";
  const rows = offers.slice(0, 9).map((o) => ({
    id: `pharm:${o.pharmacy.id}`,
    title: o.pharmacy.name,
    description: `${formatUsd(o.priceCents)} · ${o.pharmacy.suburb}`,
  }));
  rows.push({ id: "menu:pharmacist", title: "Talk to a pharmacist", description: "Ask before you order" });
  const rxNote = med.rx ? "\n📄 Prescription needed." : "";
  await prompt(s, () => wa.sendList(to, `${med.name}${rxNote}\nOpen pharmacies, cheapest first:`, "Compare prices", rows, "Pharmacies"));
}

async function askZone(to: string, s: Session): Promise<void> {
  s.step = "PICK_ZONE";
  await prompt(s, () =>
    wa.sendButtons(
      to,
      `Where should we deliver?\nCBD ${formatUsd(ZONES.CBD.feeCents)} · Inner ${formatUsd(ZONES.INNER.feeCents)} · Outer ${formatUsd(ZONES.OUTER.feeCents)}`,
      [
        { id: "zone:CBD", title: "CBD" },
        { id: "zone:INNER", title: "Inner suburbs" },
        { id: "zone:OUTER", title: "Outer suburbs" },
      ],
    ),
  );
}

async function showSummary(to: string, s: Session, order: Order): Promise<void> {
  const med = getMedicine(order.medicineId);
  const pharmacy = getPharmacy(order.pharmacyId);
  const t = orderTotals(order.unitCents, order.qty, order.deliveryCents);
  s.step = "SUMMARY";
  await prompt(s, () =>
    wa.sendButtons(
      to,
      `🧾 Order ${order.id}\n${order.qty} × ${med?.name ?? "Medicine"}\nFrom: ${pharmacy?.name ?? ""}\nTo: ${order.suburb}, ${order.address}\n\nMedicine ${formatUsd(t.medicineCents)}\nDelivery ${formatUsd(t.deliveryCents)}\n*Total ${formatUsd(t.totalCents)}*`,
      [
        { id: "pay:now", title: "Pay now" },
        { id: "pay:cancel", title: "Cancel" },
      ],
    ),
  );
}

async function askPayMethod(to: string, s: Session): Promise<void> {
  if (!env.ONEMONEY_ENABLED) {
    s.payMethod = "ecocash";
    return askPayer(to, s);
  }
  s.step = "PICK_METHOD";
  await prompt(s, () =>
    wa.sendButtons(to, "How would you like to pay?", [
      { id: "method:ecocash", title: "EcoCash" },
      { id: "method:onemoney", title: "OneMoney" },
    ]),
  );
}

/** The customer's own WhatsApp number, if it can pay with this method. */
function ownPayerNumber(whatsappNumber: string, method: PayMethod | null): string | null {
  const local = normalizeZwMobile(whatsappNumber);
  return local && method && networkMatches(local, method) ? local : null;
}

async function askPayer(to: string, s: Session): Promise<void> {
  const own = ownPayerNumber(to, s.payMethod);
  if (!own) return askOtherPayer(to, s);
  const label = s.payMethod === "onemoney" ? "OneMoney" : "EcoCash";
  s.step = "CONFIRM_PAYER";
  await prompt(s, () =>
    wa.sendButtons(to, `Pay with ${label} from this number (${formatLocalNumber(own)})?`, [
      { id: "payer:self", title: "Yes, this number" },
      { id: "payer:other", title: "Use another number" },
    ]),
  );
}

async function askOtherPayer(to: string, s: Session): Promise<void> {
  const label = s.payMethod === "onemoney" ? "OneMoney" : "EcoCash";
  s.step = "ASK_PAYER";
  await prompt(s, () =>
    wa.sendText(to, `Type the ${label} number that will pay (e.g. 0772 123 456). That phone will get the PIN prompt.`),
  );
}

async function beginPayment(to: string, s: Session, order: Order, method: PayMethod, payer: string): Promise<void> {
  if (!transition(order, "AWAITING_PAYMENT", to)) return didntGetThat(to, s);
  const t = orderTotals(order.unitCents, order.qty, order.deliveryCents);
  order.paymentAttempts += 1;
  const reference = `${order.id}-${order.paymentAttempts}`;
  const result = await startPayment(order.id, reference, `MediDrop order ${order.id}`, t.totalCents, payer, method);
  if (!result.ok) {
    transition(order, "PAYMENT_FAILED", "paynow");
    return paymentFailed(to, s, "The payment couldn't start.");
  }
  order.payment = { reference, pollUrl: result.pollUrl, simulated: result.simulated, startedAt: Date.now() };
  s.step = "WAIT_PAYMENT";
  const demoNote = result.simulated ? "\n\n(Demo mode: this payment will confirm automatically.)" : "";
  const billed = env.PAYNOW_PAY_PHONE || payer;
  const own = normalizeZwMobile(to);
  const instruction =
    billed === own
      ? `📲 Check your phone and enter your PIN to approve ${formatUsd(t.totalCents)}.`
      : `📲 We've sent a ${formatUsd(t.totalCents)} request to ${formatLocalNumber(billed)}. Ask them to enter their PIN to approve it.`;
  await wa.sendText(to, `${instruction}${demoNote}`);
  watchPayment(order);
}

async function paymentFailedFor(order: Order, reason: string): Promise<void> {
  const s = session(order.customer);
  if (s.orderId === order.id) return paymentFailed(order.customer, s, reason);
  await wa.sendText(order.customer, `❌ Payment for order ${order.id} didn't go through. You have not been charged.`);
}

async function paymentFailed(to: string, s: Session, reason: string): Promise<void> {
  s.step = "PAY_FAILED";
  await prompt(s, () =>
    wa.sendButtons(to, `❌ ${reason} You have not been charged.`, [
      { id: "pay:now", title: "Try again" },
      { id: "pay:cancel", title: "Cancel order" },
    ]),
  );
}

const watching = new Set<string>();

function watchPayment(order: Order): void {
  if (watching.has(order.id)) return;
  watching.add(order.id);
  const timer = setInterval(() => {
    void (async () => {
      if (order.status !== "AWAITING_PAYMENT" || !order.payment) {
        clearInterval(timer);
        watching.delete(order.id);
        return;
      }
      await confirmPayment(order.id);
      if (order.status === "AWAITING_PAYMENT" && Date.now() - order.payment.startedAt > PAYMENT_TIMEOUT_MS) {
        if (transition(order, "PAYMENT_FAILED", "timeout")) {
          await paymentFailedFor(order, "The payment timed out.");
        }
      }
    })().catch((err) => console.error("[PAY] watcher error:", err instanceof Error ? err.message : err));
  }, 5000);
}

/** Asks Paynow for the real status. Safe to call many times (idempotent). */
export async function confirmPayment(orderId: string): Promise<void> {
  const order = orders.get(orderId);
  if (!order || order.status !== "AWAITING_PAYMENT" || !order.payment) return;
  const state = await checkPayment(order.payment.pollUrl, order.payment.simulated, order.payment.startedAt);
  if (state === "paid") return onPaid(order);
  if (state === "failed" && transition(order, "PAYMENT_FAILED", "paynow")) {
    await paymentFailedFor(order, "The payment was cancelled or didn't go through.");
  }
}

async function onPaid(order: Order): Promise<void> {
  if (!transition(order, "PAID", "paynow")) return; // already handled
  const s = session(order.customer);
  if (s.orderId === order.id) {
    s.step = "MENU";
    s.orderId = null;
  }
  const pharmacy = getPharmacy(order.pharmacyId);
  const med = getMedicine(order.medicineId);
  await wa.sendText(order.customer, `Payment received ✅\nOrder ${order.id} is with ${pharmacy?.name ?? "the pharmacy"}. I'll update you at every step.`);
  await wa.sendButtons(
    env.PHARMACIST_PHONE,
    `🆕 PAID order ${order.id}\n${order.qty} × ${med?.name ?? ""}\nDeliver to: ${order.suburb}\n\nPack it in a sealed bag tagged ${order.id}, then tap below.`,
    [{ id: `ph:ready:${order.id}`, title: "Ready for pickup" }],
  );
}

async function showTracking(to: string): Promise<void> {
  const mine = [...orders.values()].filter((o) => o.customer === to && o.status !== "DRAFT" && o.status !== "CANCELLED");
  const active = mine.filter((o) => !TERMINAL.includes(o.status));
  const list = (active.length ? active : mine.slice(-3)).map((o) => `• ${o.id}: ${statusLabel(o.status)}`);
  await wa.sendText(to, list.length ? `Your orders:\n${list.join("\n")}` : "You don't have any orders yet. Type MENU to order.");
}

// ---------------------------------------------------------------- pharmacist

async function sendScriptToPharmacist(order: Order): Promise<void> {
  const med = getMedicine(order.medicineId);
  const caption = `📄 Script for ${order.id}: ${order.qty} × ${med?.name ?? ""}`;
  const copied = order.scriptMediaId ? await wa.copyMedia(order.scriptMediaId) : null;
  if (copied) await wa.sendImage(env.PHARMACIST_PHONE, copied, caption);
  else await wa.sendText(env.PHARMACIST_PHONE, `${caption}\n(Image couldn't be forwarded. In v1 you'll view it in the dashboard.)`);
  await wa.sendButtons(env.PHARMACIST_PHONE, `Approve the script for ${order.id}?`, [
    { id: `rx:approve:${order.id}`, title: "Approve" },
    { id: `rx:reject:${order.id}`, title: "Reject" },
  ]);
}

async function pharmacist(m: Incoming): Promise<void> {
  const to = m.from;
  const id = replyId(m);
  const [kind, action, orderId] = id.split(":");
  const order = orderId ? orders.get(orderId) : undefined;

  if (kind === "rx" && order) {
    const s = session(order.customer);
    if (action === "approve" && transition(order, "QUOTED", "pharmacist")) {
      await wa.sendText(to, `✅ Approved ${order.id}. The customer has been asked to pay.`);
      await wa.sendText(order.customer, "✅ Your script was approved by the pharmacist.");
      s.orderId = order.id;
      return showSummary(order.customer, s, order);
    }
    if (action === "reject" && transition(order, "REJECTED", "pharmacist")) {
      if (s.orderId === order.id) {
        s.step = "MENU";
        s.orderId = null;
      }
      await wa.sendText(to, `❌ Rejected ${order.id}. The customer has been told.`);
      await wa.sendButtons(
        order.customer,
        `The pharmacist couldn't approve your script for ${order.id} (it may be unclear or expired). You have not been charged.`,
        [
          { id: "menu:rx", title: "Upload another" },
          { id: "menu:pharmacist", title: "Talk to pharmacist" },
        ],
      );
      return;
    }
    await wa.sendText(to, `${order.id} has already been handled.`);
    return;
  }

  if (kind === "ph" && action === "ready" && order) {
    if (!transition(order, "READY", "pharmacist")) {
      await wa.sendText(to, `${order.id} has already been handled.`);
      return;
    }
    await wa.sendText(to, `👍 ${order.id} marked ready. Finding a driver.`);
    await wa.sendText(order.customer, `📦 Order ${order.id} is packed and ready. Finding a driver now.`);
    return dispatch(order);
  }

  await wa.sendText(to, "💊 Pharmacist mode is on. New scripts and paid orders will arrive here.");
}

// ---------------------------------------------------------------- driver

async function dispatch(order: Order): Promise<void> {
  if (!driverOnline) {
    if (!waitingForDriver.includes(order.id)) waitingForDriver.push(order.id);
    await wa.sendText(env.PHARMACIST_PHONE, `⚠️ No driver is online for ${order.id}. Ask the driver to send ON.`);
    return;
  }
  const pharmacy = getPharmacy(order.pharmacyId);
  // Drivers never see medicine names.
  await wa.sendButtons(
    env.DRIVER_PHONE,
    `🛵 New job ${order.id}\nPickup: ${pharmacy?.name ?? ""}, ${pharmacy?.address ?? ""}\nDrop-off: ${order.suburb}, ${order.address}`,
    [
      { id: `drv:accept:${order.id}`, title: "Accept" },
      { id: `drv:decline:${order.id}`, title: "Decline" },
    ],
  );
}

const driverActive = { orderId: null as string | null };

async function driver(m: Incoming): Promise<void> {
  const to = m.from;
  const text = textOf(m).toUpperCase();
  const id = replyId(m);

  if (text === "ON") {
    driverOnline = true;
    await wa.sendText(to, "🟢 You're online. Jobs will arrive here. Send OFF to go offline.");
    const pending = waitingForDriver.splice(0);
    for (const orderId of pending) {
      const order = orders.get(orderId);
      if (order?.status === "READY") await dispatch(order);
    }
    return;
  }
  if (text === "OFF") {
    driverOnline = false;
    await wa.sendText(to, "🔴 You're offline. Send ON when you start your shift.");
    return;
  }

  const [kind, action, orderId] = id.split(":");
  const order = orderId ? orders.get(orderId) : undefined;
  if (kind === "drv" && order) {
    if (action === "accept" && transition(order, "DRIVER_ASSIGNED", "driver")) {
      const pharmacy = getPharmacy(order.pharmacyId);
      await wa.sendText(order.customer, `🛵 Driver assigned: ${env.DRIVER_NAME}. They're collecting order ${order.id}.`);
      await wa.sendButtons(
        to,
        `Go to ${pharmacy?.name ?? "the pharmacy"}. Collect the sealed bag tagged ${order.id}. Tap Collected once you have it.`,
        [{ id: `drv:collected:${order.id}`, title: "Collected" }],
      );
      return;
    }
    if (action === "decline" && order.status === "READY") {
      await wa.sendText(to, `OK, ${order.id} declined.`);
      await wa.sendText(env.PHARMACIST_PHONE, `⚠️ The driver declined ${order.id}. Dispatch needs to reassign it.`);
      return;
    }
    if (action === "collected" && transition(order, "COLLECTED", "driver")) {
      driverActive.orderId = order.id;
      await wa.sendText(
        order.customer,
        `🛵 Order ${order.id} is on the way!\n\nYour delivery code is *${order.deliveryCode}*.\nOnly give this code to the driver when you have your medicine.`,
      );
      await wa.sendText(to, `Customer phone: +${order.customer}\nDeliver to: ${order.suburb}, ${order.address}\n\nAt the door, ask for their 4-digit code and type it here.`);
      return;
    }
    await wa.sendText(to, `${order.id} has already been handled.`);
    return;
  }

  if (/^\d{4}$/.test(text) && driverActive.orderId) {
    const order = orders.get(driverActive.orderId);
    if (!order || order.status !== "COLLECTED") return;
    const result = checkDeliveryCode(order, text);
    if (result.result === "ok") {
      transition(order, "DELIVERED", "driver");
      driverActive.orderId = null;
      await wa.sendText(to, `✅ ${order.id} delivered. Great job!`);
      await wa.sendText(order.customer, `Delivered ✅ Thank you for using MediDrop, ${order.customerName}! Type MENU to order again.`);
      await wa.sendText(env.PHARMACIST_PHONE, `✅ ${order.id} was delivered.`);
      return;
    }
    if (result.result === "wrong") {
      await wa.sendText(to, `❌ Wrong code. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? "try" : "tries"} left.`);
      return;
    }
    transition(order, "ISSUE", "driver");
    driverActive.orderId = null;
    await wa.sendText(to, "⚠️ Too many wrong codes. Dispatch has been alerted and will call you.");
    await wa.sendText(adminPhone(), `⚠️ ISSUE on ${order.id}: 3 wrong delivery codes.`);
    return;
  }

  await wa.sendText(to, driverOnline ? "🟢 You're online. Waiting for jobs." : "Send ON to start your shift.");
}

// ---------------------------------------------------------------- idle carts

setInterval(() => {
  const now = Date.now();
  for (const [phone, s] of sessions) {
    const order = currentOrder(s);
    if (!order || order.status !== "DRAFT") continue;
    if (now - s.updatedAt < CART_TIMEOUT_MS) continue;
    transition(order, "CANCELLED", "timeout");
    s.orderId = null;
    s.step = "MENU";
    void wa.sendText(phone, "Your order was cancelled because it wasn't finished. Type MENU to start again.");
  }
}, 60_000).unref();
