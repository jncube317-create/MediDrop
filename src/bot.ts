// Conversation logic for the Greens demo: customer + store staff.
// State is kept in memory (fine for the demo; v1 stores it in a database).

import { env } from "./env";
import * as wa from "./wa";
import { CATEGORIES, getCategory, getProduct, productImageUrl, productsIn, findProducts, type Product } from "./data";
import { addToCart, cartLines, cartTotal, itemCount, lineTotal, removeOne, type CartLine } from "./cart";
import { formatUsd, splitPayment } from "./money";
import { availableSlots, type Slot } from "./slots";
import {
  type Order,
  TERMINAL,
  checkPickupCode,
  markMissing,
  newPickupCode,
  newQrToken,
  statusLabel,
  transition,
} from "./orders";
import { checkPayment, startPayment, type PayMethod } from "./pay";
import { formatLocalNumber, networkMatches, normalizeZwMobile } from "./paystatus";
import { checkoutNudgeFor, featuredSpecial, pairingFor, specialFor, specialProducts, withSpecialPrice } from "./promos";

export type Incoming =
  | { from: string; kind: "text"; text: string }
  | { from: string; kind: "reply"; id: string }
  | { from: string; kind: "other" };

type Step =
  | "ASK_CONSENT"
  | "ASK_NAME"
  | "MENU"
  | "PICK_CATEGORY"
  | "BROWSE"
  | "ASK_SEARCH"
  | "CART"
  | "EDIT_CART"
  | "CHECKOUT_NUDGE"
  | "PICK_SLOT"
  | "SUMMARY"
  | "PICK_METHOD"
  | "CONFIRM_PAYER"
  | "ASK_PAYER"
  | "WAIT_PAYMENT"
  | "PAY_FAILED";

interface Session {
  step: Step;
  name: string | null;
  cart: CartLine[];
  orderId: string | null; // the order being checked out
  payMethod: PayMethod | null;
  nudges: { pairing: boolean; checkout: boolean }; // each shown at most once per order
  updatedAt: number;
  reprompt: (() => Promise<unknown>) | null;
}

const sessions = new Map<string, Session>();
const orders = new Map<string, Order>();
const wallets = new Map<string, number>(); // customer phone → cents
let orderSeq = 2040;

const CHECKOUT_TIMEOUT_MS = 30 * 60 * 1000;
const PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;
const PAYING_STEPS: Step[] = ["WAIT_PAYMENT"];
const CHECKOUT_STEPS: Step[] = ["CHECKOUT_NUDGE", "PICK_SLOT", "SUMMARY", "PICK_METHOD", "CONFIRM_PAYER", "ASK_PAYER", "PAY_FAILED"];

/** For the receipt QR route in server.ts. */
export function findOrderByQrToken(token: string): Order | undefined {
  for (const o of orders.values()) if (o.qrToken === token && (o.status === "PAID" || o.status === "READY")) return o;
  return undefined;
}

function session(phone: string): Session {
  let s = sessions.get(phone);
  if (!s) {
    s = { step: "ASK_CONSENT", name: null, cart: [], orderId: null, payMethod: null, nudges: { pairing: false, checkout: false }, updatedAt: Date.now(), reprompt: null };
    sessions.set(phone, s);
  }
  s.updatedAt = Date.now();
  return s;
}

function wallet(phone: string): number {
  return wallets.get(phone) ?? 0;
}

function currentOrder(s: Session): Order | undefined {
  return s.orderId ? orders.get(s.orderId) : undefined;
}

const textOf = (m: Incoming) => (m.kind === "text" ? m.text.trim() : "");
const replyId = (m: Incoming) => (m.kind === "reply" ? m.id : "");
const spacedCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

// ---------------------------------------------------------------- entry point

export async function handleIncoming(m: Incoming): Promise<void> {
  if (m.from === env.STAFF_PHONE) return staff(m);
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

/** Drops an unpaid checkout (the cart itself is kept). */
function cancelCheckout(to: string, s: Session): void {
  const order = currentOrder(s);
  if (order && (order.status === "DRAFT" || order.status === "PAYMENT_FAILED")) transition(order, "CANCELLED", to);
  s.orderId = null;
}

async function customer(m: Incoming): Promise<void> {
  const to = m.from;
  const s = session(to);
  const text = textOf(m);
  const id = replyId(m);

  // First contact: consent → name.
  if (s.step === "ASK_CONSENT") {
    if (id === "consent:yes") {
      console.log(`[CONSENT] ...${to.slice(-4)} agreed at ${new Date().toISOString()} (text v1)`);
      s.step = "ASK_NAME";
      await wa.sendText(to, "Thank you 🙏 What's your first name?");
      return;
    }
    if (id === "consent:no") {
      await wa.sendText(to, "No problem. We need this to prepare your orders, so we can't take one without it. Type HI if you change your mind.");
      return;
    }
    return askConsent(to);
  }
  if (s.step === "ASK_NAME") {
    if (!text) return void (await wa.sendText(to, "Please type your first name."));
    s.name = text.slice(0, 30);
    return showMenu(to, s, `Welcome to ${env.STORE_NAME}, ${s.name} 👋`, true);
  }

  // Global commands.
  if (/^(menu|hi|hello|hey|start)$/i.test(text)) {
    if (PAYING_STEPS.includes(s.step)) {
      await wa.sendText(to, "We're still waiting for your payment. I'll message you as soon as it goes through.");
      return;
    }
    cancelCheckout(to, s);
    return showMenu(to, s, `Hi ${s.name ?? "there"} 👋`, true);
  }
  if (/^help$/i.test(text)) {
    await wa.sendText(
      to,
      "How it works:\n1. Add groceries to your cart\n2. Pick a pickup time\n3. Pay with EcoCash\n4. Show your code at the pickup counter and go\n\nType MENU, CART, or the name of any product.",
    );
    return;
  }

  // Adding from a product card works whenever you're not paying.
  if (id.startsWith("add:")) {
    if (PAYING_STEPS.includes(s.step)) {
      await wa.sendText(to, "Please finish paying for this order first. You can start a new cart once it's paid.");
      return;
    }
    if (CHECKOUT_STEPS.includes(s.step)) cancelCheckout(to, s);
    return addProduct(to, s, id.slice(4));
  }

  // The edit-cart list stays in the chat, so its taps work whenever you're not paying.
  if ((id.startsWith("rm:") || id === "cart:clear") && !PAYING_STEPS.includes(s.step)) {
    if (CHECKOUT_STEPS.includes(s.step)) cancelCheckout(to, s);
    if (id === "cart:clear") {
      s.cart = [];
      await wa.sendText(to, "🗑️ Your cart is empty.");
      return showMenu(to, s, "Main menu");
    }
    if (removeOne(s.cart, id.slice(3))) return showCart(to, s, "Removed one.");
    return showCart(to, s, "That item is no longer in your cart.");
  }

  // Menu actions work from anywhere except while paying.
  if ((id.startsWith("menu:") || /^cart$/i.test(text)) && !PAYING_STEPS.includes(s.step)) {
    const action = /^cart$/i.test(text) ? "menu:cart" : id;
    if (CHECKOUT_STEPS.includes(s.step) && action !== "menu:checkout") cancelCheckout(to, s);
    switch (action) {
      case "menu:main":
        return showMenu(to, s, "Main menu");
      case "menu:shop":
        return showCategories(to, s);
      case "menu:specials":
        return showSpecials(to, s);
      case "menu:search":
        s.step = "ASK_SEARCH";
        await prompt(s, () => wa.sendText(to, "Type what you're looking for (e.g. bread, Mazoe, OMO)."));
        return;
      case "menu:cart":
        return showCart(to, s);
      case "menu:checkout":
        return startCheckout(to, s);
      case "menu:edit":
        return showEditCart(to, s);
      case "menu:reorder":
        return reorder(to, s);
      case "menu:track":
        return showTracking(to);
      case "menu:wallet":
        await wa.sendText(
          to,
          `💰 Your ${env.STORE_NAME} wallet: *${formatUsd(wallet(to))}*\n\nMoney goes in here when an item is out of stock, so you never wait for change. It's used automatically at your next checkout.`,
        );
        return;
    }
  }

  // "I'm here" from the ready message.
  if (id.startsWith("here:")) return imHere(to, id.slice(5));

  switch (s.step) {
    case "MENU":
    case "PICK_CATEGORY":
    case "BROWSE":
    case "CART":
    case "ASK_SEARCH": {
      if (id.startsWith("cat:")) {
        const cat = getCategory(id.slice(4));
        if (!cat) return didntGetThat(to, s);
        s.step = "BROWSE";
        await wa.sendText(to, `*${cat.name}*`);
        await sendProductCards(to, productsIn(cat.key), "Tap 🛒 *Add to cart* on anything you want.");
        return;
      }
      // Typing a product name works from these steps.
      if (text) return search(to, s, text);
      return didntGetThat(to, s);
    }

    case "EDIT_CART":
      return didntGetThat(to, s);

    case "CHECKOUT_NUDGE": {
      if (id === "nudge:skip") return askSlot(to, s);
      if (id.startsWith("nudge:add:")) {
        const p = getProduct(id.slice(10));
        if (p && addToCart(s.cart, withSpecialPrice(p)).ok) {
          await wa.sendText(to, `✅ Added ${p.name}. 🛒 ${itemCount(s.cart)} items · ${formatUsd(cartTotal(s.cart))}`);
        }
        return askSlot(to, s);
      }
      return didntGetThat(to, s);
    }

    case "PICK_SLOT": {
      const slot = id.startsWith("slot:") ? slotsNow().find((x) => x.id === id.slice(5)) : undefined;
      if (!slot) {
        if (id.startsWith("slot:")) {
          await wa.sendText(to, "Sorry, that time just filled up or passed. Please pick another.");
          return askSlot(to, s);
        }
        return didntGetThat(to, s);
      }
      return createDraft(to, s, slot);
    }

    case "SUMMARY": {
      const order = currentOrder(s);
      if (!order) return didntGetThat(to, s);
      if (id === "pay:now") {
        if (!slotsNow().some((x) => x.id === order.slot.id)) {
          cancelCheckout(to, s);
          await wa.sendText(to, "Sorry, that pickup time is no longer available. Please pick another.");
          return askSlot(to, s);
        }
        return payNow(to, s, order);
      }
      if (id === "pay:time") {
        cancelCheckout(to, s);
        return askSlot(to, s);
      }
      if (id === "pay:cancel") {
        cancelCheckout(to, s);
        return showMenu(to, s, "Checkout cancelled. Nothing was charged and your cart is saved.");
      }
      return didntGetThat(to, s);
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
        cancelCheckout(to, s);
        return showMenu(to, s, "Checkout cancelled. Nothing was charged and your cart is saved.");
      }
      return didntGetThat(to, s);
    }
  }
}

async function askConsent(to: string): Promise<void> {
  await wa.sendButtons(
    to,
    `Welcome to ${env.STORE_NAME} 🛒\n\nOrder your groceries here, pay with EcoCash, then collect them at the store. No queue, no change problems.\n\nWe store your name, number and orders so we can prepare them. Do you agree?`,
    [
      { id: "consent:yes", title: "I agree" },
      { id: "consent:no", title: "No thanks" },
    ],
  );
}

function lastOrder(to: string): Order | undefined {
  const mine = [...orders.values()].filter(
    (o) => o.customer === to && (o.status === "PAID" || o.status === "READY" || o.status === "COLLECTED"),
  );
  return mine[mine.length - 1];
}

async function showMenu(to: string, s: Session, greeting: string, withFeatured = false): Promise<void> {
  s.step = "MENU";
  if (withFeatured) await sendFeaturedCard(to);
  const count = itemCount(s.cart);
  const rows = [
    { id: "menu:shop", title: "Shop by category", description: "Bakery, food & drinks, household" },
    { id: "menu:search", title: "Search for a product" },
    {
      id: "menu:cart",
      title: "My cart",
      description: count ? `${count} item${count === 1 ? "" : "s"} · ${formatUsd(cartTotal(s.cart))}` : "Empty",
    },
  ];
  if (lastOrder(to)) rows.push({ id: "menu:reorder", title: "Reorder last basket", description: "Add everything from your last order" });
  rows.push({ id: "menu:track", title: "Track my order" });
  rows.push({ id: "menu:wallet", title: `My ${env.STORE_NAME} wallet`.slice(0, 24), description: `Balance ${formatUsd(wallet(to))}` });
  await prompt(s, () =>
    wa.sendList(to, `${greeting}\nWhat would you like to do? You can also just type a product name.`, "Menu", rows, env.STORE_NAME.slice(0, 24)),
  );
}

async function showCategories(to: string, s: Session): Promise<void> {
  s.step = "PICK_CATEGORY";
  await prompt(s, () =>
    wa.sendList(
      to,
      "Pick a section:",
      "Sections",
      [
        { id: "menu:specials", title: "⭐ Specials", description: "This week's deals" },
        ...CATEGORIES.map((c) => ({ id: `cat:${c.key}`, title: c.name, description: c.blurb })),
      ],
      "Shop",
    ),
  );
}

function priceText(p: Product): string {
  if (!p.inStock) return "*Out of stock*";
  const special = specialFor(p.id);
  return special ? `*${formatUsd(special.priceCents)}* ~${formatUsd(special.wasCents)}~` : `*${formatUsd(p.priceCents)}*`;
}

function cardText(p: Product): string {
  const tag = specialFor(p.id) && p.inStock ? "⭐ *Special* · " : "";
  return `${tag}*${p.name}*\n${p.size} · ${priceText(p)}\n\n${p.blurb}`;
}

/** The sponsored card shown when a customer opens the menu. */
async function sendFeaturedCard(to: string): Promise<void> {
  const special = featuredSpecial();
  const p = special ? getProduct(special.productId) : undefined;
  if (!special || !p) return;
  const imageUrl = productImageUrl(env.PUBLIC_URL, p.id) ?? undefined;
  await wa.sendButtons(
    to,
    `⭐ *Featured this week*\n*${p.name}*\n${p.size} · ${priceText(p)}\n\n${p.blurb}`,
    [
      { id: `add:${p.id}`, title: "🛒 Add to cart" },
      { id: "menu:specials", title: "See all specials" },
    ],
    { imageUrl, footer: "Sponsored · demo special" },
  );
}

async function showSpecials(to: string, s: Session): Promise<void> {
  s.step = "BROWSE";
  const list = specialProducts();
  if (list.length === 0) {
    await wa.sendText(to, "No specials right now. Check back soon!");
    return showCategories(to, s);
  }
  await wa.sendText(to, "⭐ *This week's specials*");
  await sendProductCards(to, list, "Tap 🛒 *Add to cart* on anything you want.");
}

const CARD_FOOTER = () => `${env.STORE_NAME} · pay with EcoCash, collect in store`.slice(0, 60);
const MAX_CARDS = 5;

/**
 * One picture card per product: photo, name, size, price, description and an
 * "Add to cart" button. Falls back to a plain list if pictures can't be sent.
 */
async function sendProductCards(to: string, products: Product[], intro: string): Promise<void> {
  const shown = products.slice(0, MAX_CARDS);
  const canShowPictures = shown.every((p) => productImageUrl(env.PUBLIC_URL, p.id));
  if (canShowPictures) {
    let allSent = true;
    for (const p of shown) {
      const sent = await wa.sendButtons(to, cardText(p), [{ id: `add:${p.id}`, title: "🛒 Add to cart" }], {
        imageUrl: productImageUrl(env.PUBLIC_URL, p.id) ?? undefined,
        footer: CARD_FOOTER(),
      });
      if (!sent) {
        allSent = false;
        break;
      }
    }
    if (allSent) {
      await wa.sendButtons(to, intro, [
        { id: "menu:shop", title: "Other sections" },
        { id: "menu:cart", title: "View cart" },
      ]);
      return;
    }
    console.warn("[WA] picture card refused; sending a plain list instead");
  } else {
    console.warn(`[IMG] No public URL, so no pictures. PUBLIC_URL="${env.PUBLIC_URL}"`);
  }
  const rows = products.slice(0, 10).map((p) => ({
    id: `add:${p.id}`,
    title: p.name,
    description: p.inStock ? `${formatUsd(p.priceCents)} · ${p.size}` : `Out of stock · ${p.size}`,
  }));
  await wa.sendList(to, "Tap a product to add it to your cart:", "See products", rows, "Products");
}

async function search(to: string, s: Session, query: string): Promise<void> {
  const matches = findProducts(query);
  if (matches.length === 0) {
    s.step = "ASK_SEARCH";
    await wa.sendButtons(to, `I couldn't find "${query.slice(0, 40)}". Try another word, or browse the sections.`, [
      { id: "menu:shop", title: "Shop by category" },
      { id: "menu:cart", title: "My cart" },
    ]);
    return;
  }
  s.step = "BROWSE";
  const more = matches.length > MAX_CARDS ? ` Showing the first ${MAX_CARDS}; type a more exact name to narrow it down.` : "";
  await sendProductCards(to, matches, `Tap 🛒 *Add to cart* on anything you want.${more}`);
}

async function addProduct(to: string, s: Session, productId: string): Promise<void> {
  const product = getProduct(productId);
  if (!product) return didntGetThat(to, s);
  const result = addToCart(s.cart, withSpecialPrice(product));
  if (!result.ok) {
    const why =
      result.reason === "out_of_stock"
        ? `Sorry, ${product.name} is out of stock right now.`
        : `You've reached the limit of ${product.maxQty} for ${product.name} per order.`;
    await wa.sendButtons(to, why, [
      { id: "menu:shop", title: "Keep shopping" },
      { id: "menu:cart", title: "My cart" },
    ]);
    return;
  }
  s.step = "BROWSE";
  const count = itemCount(s.cart);
  await wa.sendButtons(
    to,
    `✅ Added ${product.name}${result.line.qty > 1 ? ` (now ${result.line.qty})` : ""}\n🛒 ${count} item${count === 1 ? "" : "s"} · ${formatUsd(cartTotal(s.cart))}`,
    [
      { id: "menu:checkout", title: "Checkout" },
      { id: "menu:shop", title: "Keep shopping" },
      { id: "menu:cart", title: "View cart" },
    ],
  );
  // Impulse nudge 1: "goes well with", once per order.
  const partner = s.nudges.pairing ? undefined : pairingFor(product.id, s.cart);
  if (partner) {
    s.nudges.pairing = true;
    await wa.sendButtons(
      to,
      `💡 *Goes well with your ${product.name}*\n*${partner.name}* · ${priceText(partner)}`,
      [{ id: `add:${partner.id}`, title: "➕ Add it" }],
      { imageUrl: productImageUrl(env.PUBLIC_URL, partner.id) ?? undefined },
    );
  }
}

async function showCart(to: string, s: Session, note = ""): Promise<void> {
  s.step = "CART";
  if (s.cart.length === 0) {
    await prompt(s, () =>
      wa.sendButtons(to, `${note ? `${note}\n` : ""}🛒 Your cart is empty.`, [
        { id: "menu:shop", title: "Shop by category" },
        { id: "menu:search", title: "Search" },
      ]),
    );
    return;
  }
  await prompt(s, () =>
    wa.sendButtons(
      to,
      `${note ? `${note}\n\n` : ""}🛒 *Your cart*\n${cartLines(s.cart)}\n\n*Total ${formatUsd(cartTotal(s.cart))}*`,
      [
        { id: "menu:checkout", title: "Checkout" },
        { id: "menu:shop", title: "Keep shopping" },
        { id: "menu:edit", title: "Edit cart" },
      ],
    ),
  );
}

async function showEditCart(to: string, s: Session): Promise<void> {
  if (s.cart.length === 0) return showCart(to, s);
  s.step = "EDIT_CART";
  const rows = s.cart.slice(0, 8).map((l) => ({
    id: `rm:${l.productId}`,
    title: l.name.slice(0, 24),
    description: `${l.qty} in cart · tap to remove one`,
  }));
  rows.push({ id: "cart:clear", title: "Empty my cart", description: "Remove everything" });
  rows.push({ id: "menu:cart", title: "Back to cart", description: "" });
  await prompt(s, () =>
    wa.sendList(
      to,
      "Tap an item to remove one of it.",
      "Edit cart",
      rows.map((r) => (r.description ? r : { id: r.id, title: r.title })),
      "Your cart",
    ),
  );
}

async function reorder(to: string, s: Session): Promise<void> {
  const last = lastOrder(to);
  if (!last) {
    await wa.sendText(to, "You don't have a past order yet.");
    return;
  }
  const skipped: string[] = [];
  for (const line of last.lines) {
    const product = getProduct(line.productId);
    if (!product) continue;
    const room = Math.min(line.qty, product.maxQty - (s.cart.find((c) => c.productId === product.id)?.qty ?? 0));
    if (room < 1 || !addToCart(s.cart, withSpecialPrice(product), room).ok) skipped.push(product.name);
  }
  const note = skipped.length ? `🔁 Added your last basket. Not available right now: ${skipped.join(", ")}.` : "🔁 Added your last basket at today's prices.";
  return showCart(to, s, note);
}

// ---------------------------------------------------------------- checkout

function bookedPerSlot(): Map<string, number> {
  const booked = new Map<string, number>();
  for (const o of orders.values()) {
    if (o.status === "AWAITING_PAYMENT" || o.status === "PAID" || o.status === "READY" || o.status === "COLLECTED") {
      booked.set(o.slot.id, (booked.get(o.slot.id) ?? 0) + 1);
    }
  }
  return booked;
}

function slotsNow(): Slot[] {
  return availableSlots(Date.now(), bookedPerSlot());
}

async function startCheckout(to: string, s: Session): Promise<void> {
  if (s.cart.length === 0) return showCart(to, s);
  const unavailable = s.cart.filter((l) => !getProduct(l.productId)?.inStock);
  if (unavailable.length) {
    for (const l of unavailable) s.cart.splice(s.cart.indexOf(l), 1);
    return showCart(to, s, `Sorry, these just went out of stock and were removed: ${unavailable.map((l) => l.name).join(", ")}.`);
  }
  // Impulse nudge 2: the "till-side" item, once per order, before choosing a time.
  const extra = s.nudges.checkout ? undefined : checkoutNudgeFor(s.cart);
  if (extra) {
    s.nudges.checkout = true;
    s.step = "CHECKOUT_NUDGE";
    await prompt(s, () =>
      wa.sendButtons(
        to,
        `Before you pay 🛒\n*${extra.name}* · ${priceText(extra)}\nAdd it to your order?`,
        [
          { id: `nudge:add:${extra.id}`, title: "Yes, add it" },
          { id: "nudge:skip", title: "No thanks" },
        ],
        { imageUrl: productImageUrl(env.PUBLIC_URL, extra.id) ?? undefined },
      ),
    );
    return;
  }
  return askSlot(to, s);
}

async function askSlot(to: string, s: Session): Promise<void> {
  const slots = slotsNow();
  if (slots.length === 0) {
    s.step = "CART";
    await wa.sendText(to, "Sorry, there are no pickup times left right now. Please try again later.");
    return;
  }
  s.step = "PICK_SLOT";
  await prompt(s, () =>
    wa.sendList(
      to,
      `When will you collect?\n📍 ${env.BRANCH_NAME}`,
      "Pickup times",
      slots.map((slot) => ({ id: `slot:${slot.id}`, title: slot.label, description: `${slot.spotsLeft} spot${slot.spotsLeft === 1 ? "" : "s"} left` })),
      "Pickup times",
    ),
  );
}

async function createDraft(to: string, s: Session, slot: Slot): Promise<void> {
  cancelCheckout(to, s);
  const totalCents = cartTotal(s.cart);
  const split = splitPayment(totalCents, wallet(to));
  const inUse = new Set([...orders.values()].filter((o) => !TERMINAL.includes(o.status)).map((o) => o.pickupCode));
  const order: Order = {
    id: `GR-${++orderSeq}`,
    customer: to,
    customerName: s.name ?? "Customer",
    lines: s.cart.map((l) => ({ ...l, missing: false })),
    slot: { id: slot.id, label: slot.label, startsAt: slot.startsAt, endsAt: slot.endsAt },
    totalCents,
    walletCents: split.walletCents,
    payCents: split.payCents,
    refundedCents: 0,
    status: "DRAFT",
    pickupCode: newPickupCode(inUse),
    qrToken: newQrToken(),
    arrived: false,
    payment: null,
    paymentAttempts: 0,
    events: [],
    createdAt: Date.now(),
    collectedAt: null,
  };
  orders.set(order.id, order);
  s.orderId = order.id;
  s.step = "SUMMARY";
  const walletLine = order.walletCents ? `\n${env.STORE_NAME} wallet −${formatUsd(order.walletCents)}` : "";
  await prompt(s, () =>
    wa.sendButtons(
      to,
      `🧾 *Order ${order.id}*\n${cartLines(order.lines)}\n\nTotal ${formatUsd(order.totalCents)}${walletLine}\n*To pay ${formatUsd(order.payCents)}*\n\n📍 ${env.BRANCH_NAME}\n🕓 ${order.slot.label}`,
      [
        { id: "pay:now", title: order.payCents ? "Pay now" : "Pay with wallet" },
        { id: "pay:time", title: "Change time" },
        { id: "pay:cancel", title: "Cancel" },
      ],
    ),
  );
}

async function payNow(to: string, s: Session, order: Order): Promise<void> {
  if (order.payCents > 0) return askPayMethod(to, s);
  // The wallet covers everything: no EcoCash needed.
  if (!transition(order, "AWAITING_PAYMENT", to)) return didntGetThat(to, s);
  return onPaid(order, "wallet");
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
  order.paymentAttempts += 1;
  const reference = `${order.id}-${order.paymentAttempts}`;
  const result = await startPayment(order.id, reference, `${env.STORE_NAME} order ${order.id}`, order.payCents, payer, method);
  if (!result.ok) {
    transition(order, "PAYMENT_FAILED", "paynow");
    return paymentFailed(to, s, "The payment couldn't start.");
  }
  order.payment = { reference, pollUrl: result.pollUrl, simulated: result.simulated, startedAt: Date.now() };
  s.step = "WAIT_PAYMENT";
  const demoNote = result.simulated ? "\n\n(Demo mode: this payment will confirm automatically.)" : "";
  const billed = env.PAYNOW_PAY_PHONE || payer;
  const instruction =
    billed === normalizeZwMobile(to)
      ? `📲 Check your phone and enter your PIN to approve ${formatUsd(order.payCents)}.`
      : `📲 We've sent a ${formatUsd(order.payCents)} request to ${formatLocalNumber(billed)}. Ask them to enter their PIN to approve it.`;
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
      { id: "pay:cancel", title: "Cancel checkout" },
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
        if (transition(order, "PAYMENT_FAILED", "timeout")) await paymentFailedFor(order, "The payment timed out.");
      }
    })().catch((err) => console.error("[PAY] watcher error:", err instanceof Error ? err.message : err));
  }, 3000);
}

/** Asks Paynow for the real status. Safe to call many times (idempotent). */
export async function confirmPayment(orderId: string): Promise<void> {
  const order = orders.get(orderId);
  if (!order || order.status !== "AWAITING_PAYMENT" || !order.payment) return;
  const state = await checkPayment(order.payment.pollUrl, order.payment.simulated, order.payment.startedAt);
  if (state === "paid") return onPaid(order, "paynow");
  if (state === "failed" && transition(order, "PAYMENT_FAILED", "paynow")) {
    await paymentFailedFor(order, "The payment was cancelled or didn't go through.");
  }
}

async function onPaid(order: Order, by: "paynow" | "wallet"): Promise<void> {
  if (!transition(order, "PAID", by)) return; // already handled
  // Take the wallet part now that the order is definitely paid.
  wallets.set(order.customer, Math.max(0, wallet(order.customer) - order.walletCents));
  const s = session(order.customer);
  if (s.orderId === order.id) {
    s.step = "MENU";
    s.orderId = null;
    s.cart = [];
    s.nudges = { pairing: false, checkout: false };
  }
  const paidWith = [
    order.payCents ? `EcoCash ${formatUsd(order.payCents)}` : "",
    order.walletCents ? `wallet ${formatUsd(order.walletCents)}` : "",
  ].filter(Boolean).join(" + ");
  await wa.sendText(
    order.customer,
    `✅ Payment received. Here's your receipt.\n\n🧾 *${env.STORE_NAME.toUpperCase()} · Order ${order.id}*\n${cartLines(order.lines)}\n\n*Total ${formatUsd(order.totalCents)}*\nPaid: ${paidWith}\n\n📍 ${env.BRANCH_NAME}\n🕓 ${order.slot.label}\n\n🔑 Pickup code: *${spacedCode(order.pickupCode)}*\nShow this code at the pickup counter. Don't share it with anyone else.`,
  );
  if (env.PUBLIC_URL.startsWith("https://")) {
    await wa.sendImageLink(order.customer, `${env.PUBLIC_URL}/qr/${order.qrToken}.png`, `Pickup QR · Order ${order.id}`);
  }
  await wa.sendText(order.customer, "We're packing your order now. I'll message you when it's ready. 📦");
  await sendPackingJob(order, "🆕 New order");
}

// ---------------------------------------------------------------- tracking + arrival

async function showTracking(to: string): Promise<void> {
  const mine = [...orders.values()].filter((o) => o.customer === to && o.status !== "DRAFT" && o.status !== "CANCELLED");
  const active = mine.filter((o) => !TERMINAL.includes(o.status));
  const list = (active.length ? active : mine.slice(-3)).map((o) => {
    const code = o.status === "PAID" || o.status === "READY" ? ` · code ${spacedCode(o.pickupCode)}` : "";
    return `• ${o.id}: ${statusLabel(o.status)}\n   🕓 ${o.slot.label}${code}`;
  });
  await wa.sendText(to, list.length ? `Your orders:\n${list.join("\n")}` : "You don't have any orders yet. Type MENU to start shopping.");
}

async function imHere(to: string, orderId: string): Promise<void> {
  const order = orders.get(orderId);
  if (!order || order.customer !== to) return;
  if (order.status === "PAID") {
    await wa.sendText(to, "Your order is still being packed. I'll message you the moment it's ready.");
    return;
  }
  if (order.status !== "READY") {
    await wa.sendText(to, `Order ${order.id}: ${statusLabel(order.status)}.`);
    return;
  }
  if (!order.arrived) {
    order.arrived = true;
    await wa.sendText(env.STAFF_PHONE, `🙋 ${order.customerName} is at the counter for *${order.id}* (bag tagged ${order.id}). Bring it out.`);
  }
  await wa.sendText(to, `👍 The team knows you're here. Show your pickup code: *${spacedCode(order.pickupCode)}*`);
}

// ---------------------------------------------------------------- staff

function packingList(order: Order): string {
  return order.lines.map((l) => `${l.missing ? "✖️" : "☐"} ${l.qty} × ${l.name}${l.missing ? " (out of stock)" : ""}`).join("\n");
}

async function sendPackingJob(order: Order, heading: string): Promise<void> {
  await wa.sendButtons(
    env.STAFF_PHONE,
    `${heading} *${order.id}* · ${order.customerName}\n🕓 Pickup ${order.slot.label}\n\n${packingList(order)}\n\nPack it in a bag tagged ${order.id}.`,
    [
      { id: `pack:${order.id}`, title: "All packed" },
      { id: `missing:${order.id}`, title: "Item missing" },
    ],
  );
}

async function staff(m: Incoming): Promise<void> {
  const to = m.from;
  const id = replyId(m);
  const text = textOf(m);
  const [kind, orderId, productId] = id.split(":");
  const order = orderId ? orders.get(orderId) : undefined;

  if (kind === "missing" && order) {
    if (order.status !== "PAID") {
      await wa.sendText(to, `${order.id} has already been packed.`);
      return;
    }
    if (productId) return staffMarkMissing(to, order, productId);
    const rows = order.lines
      .filter((l) => !l.missing)
      .slice(0, 10)
      .map((l) => ({ id: `missing:${order.id}:${l.productId}`, title: l.name.slice(0, 24), description: `${l.qty} ordered · ${formatUsd(lineTotal(l))}` }));
    await wa.sendList(to, `Which item is out of stock for ${order.id}? The customer gets the money back in their wallet.`, "Pick item", rows, "Items");
    return;
  }

  if (kind === "pack" && order) {
    if (!transition(order, "READY", "staff")) {
      await wa.sendText(to, `${order.id} has already been handled.`);
      return;
    }
    await wa.sendText(to, `👍 ${order.id} is ready. When the customer shows their code, type the 6 digits here.`);
    const missingNote = order.refundedCents ? `\n(Missing items: ${formatUsd(order.refundedCents)} is in your wallet.)` : "";
    await wa.sendButtons(
      order.customer,
      `📦 Order *${order.id}* is packed and waiting at the pickup counter.${missingNote}\n\n📍 ${env.BRANCH_NAME}\n🕓 ${order.slot.label}\n\nTap *I'm here* when you arrive.`,
      [{ id: `here:${order.id}`, title: "I'm here" }],
    );
    return;
  }

  if (kind === "handover" && order) {
    if (!transition(order, "COLLECTED", "staff")) {
      await wa.sendText(to, `${order.id} was already handed over.`);
      return;
    }
    order.collectedAt = Date.now();
    await wa.sendText(to, `✅ ${order.id} collected. Done.`);
    await wa.sendText(order.customer, `Collected ✅ Thanks for shopping with ${env.STORE_NAME}, ${order.customerName}! Type MENU to order again.`);
    return;
  }

  // A pickup code typed at the counter.
  if (/^\d[\d\s]{4,}\d$/.test(text)) {
    const check = checkPickupCode(orders.values(), text);
    switch (check.result) {
      case "ok": {
        const o = check.order;
        const handOver = o.lines.filter((l) => !l.missing).map((l) => `☑️ ${l.qty} × ${l.name}`).join("\n");
        await wa.sendButtons(
          to,
          `✅ *Code valid*\nOrder ${o.id} · ${o.customerName}\nPaid ${formatUsd(o.totalCents)}\n\n${handOver}\n\nHand over the bag tagged ${o.id}, then tap below.`,
          [{ id: `handover:${o.id}`, title: "Handed over" }],
        );
        return;
      }
      case "still_packing":
        await wa.sendText(to, `⚠️ ${check.order.id} isn't marked packed yet. Finish packing and tap *All packed* first.`);
        return;
      case "already_collected": {
        const at = check.order.collectedAt
          ? new Date(check.order.collectedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Harare" })
          : "earlier";
        await wa.sendText(to, `⛔ *Code already used.* ${check.order.id} was collected at ${at}. Do NOT hand over another bag.`);
        return;
      }
      case "not_found":
        await wa.sendText(to, "❌ No order with that code. Check the 6 digits and try again.");
        return;
    }
  }

  if (/^orders?$/i.test(text)) {
    const active = [...orders.values()].filter((o) => o.status === "PAID" || o.status === "READY");
    await wa.sendText(
      to,
      active.length
        ? `Open orders:\n${active.map((o) => `• ${o.id} · ${o.customerName} · ${statusLabel(o.status)} · ${o.slot.label}${o.arrived ? " · 🙋 here" : ""}`).join("\n")}`
        : "No open orders right now.",
    );
    return;
  }

  await wa.sendText(
    to,
    `🏪 ${env.STORE_NAME} staff mode.\nNew orders arrive here to pack.\nType a customer's 6-digit pickup code to check it.\nType ORDERS to see open orders.`,
  );
}

async function staffMarkMissing(to: string, order: Order, productId: string): Promise<void> {
  const result = markMissing(order, productId);
  if (!result.ok) {
    await wa.sendText(to, result.reason === "already_missing" ? "That item is already marked missing." : `${order.id} can't be changed now.`);
    return;
  }
  const line = order.lines.find((l) => l.productId === productId);
  wallets.set(order.customer, wallet(order.customer) + result.refundCents);
  if (result.allMissing) {
    transition(order, "ISSUE", "staff");
    await wa.sendText(to, `Everything in ${order.id} is out of stock. ${formatUsd(order.refundedCents)} went to the customer's wallet. The order is closed.`);
    await wa.sendText(
      order.customer,
      `😔 Sorry ${order.customerName}, none of the items in ${order.id} were in stock. *${formatUsd(order.refundedCents)}* has been added to your ${env.STORE_NAME} wallet for your next order. Type MENU to shop again.`,
    );
    return;
  }
  await wa.sendText(
    order.customer,
    `😔 Sorry, *${line?.name ?? "one item"}* was out of stock. *${formatUsd(result.refundCents)}* has been added to your ${env.STORE_NAME} wallet and comes off your next order. The rest is being packed.`,
  );
  await sendPackingJob(order, `✏️ Updated (${formatUsd(result.refundCents)} to wallet)`);
}

// ---------------------------------------------------------------- idle checkouts

setInterval(() => {
  const now = Date.now();
  for (const [phone, s] of sessions) {
    const order = currentOrder(s);
    if (!order || order.status !== "DRAFT") continue;
    if (now - s.updatedAt < CHECKOUT_TIMEOUT_MS) continue;
    transition(order, "CANCELLED", "timeout");
    s.orderId = null;
    s.step = "MENU";
    void wa.sendText(phone, "Your checkout timed out, so that pickup time was released. Your cart is saved. Type CART to continue.");
  }
}, 60_000).unref();
