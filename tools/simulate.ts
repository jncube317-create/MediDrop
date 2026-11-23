// Runs a full Scoutly demo through the real server with a fake WhatsApp API.
// No Meta account needed. Run: npm run simulate
// It prints what each phone would see.

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const CUSTOMER = "263771234567";
const PROVIDER = "263782222222";
const ADMIN = "263773333333";
const BUYER2 = "263784444444";
const GRAPH_PORT = 4999;
const BOT_PORT = 4998;

interface Sent {
  to: string;
  type: string;
  body: string;
  options: string[]; // button / row / card ids
}

const outbox: Sent[] = [];
const NAMES: Record<string, string> = { [CUSTOMER]: "CUSTOMER", [PROVIDER]: "PROVIDER", [ADMIN]: "ADMIN", [BUYER2]: "BUYER2" };

// ---- fake Meta Graph API: records every message the bot sends
const graph = createServer((req, res) => {
  // Photos people send: media lookup, then the download itself.
  if (req.method === "GET" && req.url?.startsWith("/dl/")) {
    res.writeHead(200, { "Content-Type": "image/jpeg" });
    res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return;
  }
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: `http://localhost:${GRAPH_PORT}/dl/photo`, mime_type: "image/jpeg" }));
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      const p = JSON.parse(raw) as Record<string, any>;
      const i = p.interactive;
      const options: string[] = [];
      let body = "";
      if (p.type === "text") body = p.text.body;
      if (p.type === "image") body = `[image] ${p.image.link} · ${p.image.caption}`;
      if (i?.type === "button") {
        body = `${i.header?.image ? `[photo ${String(i.header.image.link).split("/").pop()}] ` : ""}${i.body.text}${i.footer ? `\n— ${i.footer.text}` : ""}`;
        options.push(...i.action.buttons.map((b: any) => `${b.reply.id} "${b.reply.title}"`));
      }
      if (i?.type === "list") {
        body = `${i.body.text}  [list: ${i.action.button}]`;
        for (const s of i.action.sections) options.push(...s.rows.map((r: any) => `${r.id} "${r.title}"${r.description ? ` – ${r.description}` : ""}`));
      }
      if (i?.type === "carousel" && process.env.SIM_REFUSE_CAROUSEL === "1") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":{"message":"(#131009) Parameter value is not valid"}}');
        return;
      }
      if (i?.type === "carousel") {
        if (i.action.cards.some((c: any) => c.type !== "cta_url")) throw new Error("card type missing");
        body = `${i.body.text}  [carousel]`;
        for (const c of i.action.cards) options.push(`${c.action.buttons[0].quick_reply.id} · ${c.body.text.replace(/\n/g, " · ")} · ${c.header.image.link.split("/").pop()}`);
      }
      outbox.push({ to: p.to, type: i?.type ?? p.type, body, options });
    } catch {
      /* ignore */
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ messages: [{ id: "wamid.sim" }] }));
  });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let msgId = 0;
let printed = 0;

async function send(from: string, what: { text?: string; reply?: string; image?: string }, wait = 400): Promise<Sent[]> {
  const who = NAMES[from] ?? from;
  console.log(`\n▶ ${who} ${what.text !== undefined ? `types "${what.text}"` : what.image ? "sends a photo" : `taps ${what.reply}`}`);
  const message = what.text !== undefined
    ? { from, id: `sim${++msgId}`, type: "text", text: { body: what.text } }
    : what.image
      ? { from, id: `sim${++msgId}`, type: "image", image: { id: what.image } }
      : { from, id: `sim${++msgId}`, type: "interactive", interactive: { button_reply: { id: what.reply, title: "" } } };
  await fetch(`http://localhost:${BOT_PORT}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [message] } }] }] }),
  });
  await sleep(wait);
  return flush();
}

function flush(): Sent[] {
  const fresh = outbox.slice(printed);
  printed = outbox.length;
  for (const m of fresh) {
    const who = `  📱 ${(NAMES[m.to] ?? m.to).toLowerCase()} sees`;
    console.log(`${who} (${m.type}):\n${m.body.split("\n").map((l) => `      ${l}`).join("\n")}`);
    for (const o of m.options) console.log(`      • ${o}`);
  }
  return fresh;
}

function check(ok: boolean, what: string): void {
  console.log(ok ? `  ✔ ${what}` : `  ✘ FAILED: ${what}`);
  if (!ok) process.exitCode = 1;
}

const has = (msgs: Sent[], to: string, re: RegExp) => msgs.some((m) => m.to === to && (re.test(m.body) || m.options.some((o) => re.test(o))));


/** Finds the first option id matching a pattern in messages to one phone, e.g. int:O-503:N-1001. */
function option(msgs: Sent[], to: string, re: RegExp): string {
  for (const m of msgs) {
    if (m.to !== to) continue;
    for (const o of m.options) {
      const hit = re.exec(o);
      if (hit) return hit[0];
    }
  }
  return "";
}

async function onboard(phone: string, name: string, role: "buy" | "sell" = "buy"): Promise<Sent[]> {
  let r = await send(phone, { text: "hi" });
  check(has(r, phone, /consent:yes/) && has(r, phone, /no illegal goods/) && has(r, phone, /aren't responsible/), `${name}: consent shows the rules and no-liability clause`);
  await send(phone, { reply: "consent:yes" });
  r = await send(phone, { text: name });
  check(has(r, phone, /city:byo/), `${name}: asks for their town`);
  r = await send(phone, { reply: "city:byo" });
  check(has(r, phone, /You have 3 free credits/), `${name}: 3 free credits on sign-up`);
  check(has(r, phone, /role:buy/) && has(r, phone, /role:sell/) && has(r, phone, /role:both/), `${name}: asked whether they're buying or selling`);
  r = await send(phone, { reply: role === "buy" ? "role:buy" : "role:sell" });
  check(has(r, phone, /quick profile[\s\S]*Everyone on Scoutly has one/) && has(r, phone, /Step 1 of 3/) && has(r, phone, /prof:usename/), `${name}: everyone starts a profile`);
  r = await send(phone, { reply: "prof:usename" });
  check(has(r, phone, /Step 2 of 3/), `${name}: profile asks about them`);
  r = await send(phone, { text: "short" });
  check(has(r, phone, /at least one full sentence/), `${name}: too-short description is refused`);
  r = await send(phone, { text: role === "buy" ? "Teacher in Bulawayo, buying for my family." : "Appliances and painting. Bulawayo, 5 years' experience, fair prices." });
  check(has(r, phone, /Step 3 of 3[\s\S]*profile photo/), `${name}: profile asks for a photo`);
  r = await send(phone, { text: "no photo" });
  check(has(r, phone, /profile photo is needed/), `${name}: the photo is required`);
  r = await send(phone, { image: "media-9" }, 700);
  check(has(r, phone, new RegExp(`\\[photo [a-f0-9-]{36}\\.jpg\\][\\s\\S]*This is what people will see[\\s\\S]*\\*${name}\\*[\\s\\S]*New member · No ratings yet`)) && has(r, phone, /prof:ok/), `${name}: profile preview shows the photo, name, rating and description`);
  r = await send(phone, { reply: "prof:ok" });
  if (role === "buy") {
    check(has(r, phone, /profile is ready/) && has(r, phone, /What are you looking for\? Say it all in \*one message\*/), `${name}: buyer's profile saved, straight into a one-message search`);
    return send(phone, { text: "MENU" });
  }
  check(has(r, phone, /profile is ready[\s\S]*first item or service/) && has(r, phone, /kind:item/), `${name}: seller's profile saved, straight into listing`);
  return r;
}

/** Posts a need from the menu, start to finish. */
/** One-message search, like a real person types it. Taps the category only if the bot asks. */
async function post(phone: string, o: { text: string; kind: "item" | "service"; cat: string; budget?: string; when: string; date?: string; where?: "city" | "any" }, wait = 400): Promise<Sent[]> {
  const extra = [
    o.budget && !o.text.includes(o.budget) ? `budget ${o.budget}` : "",
    o.when === "today" ? "today" : o.when === "week" ? "this week" : o.when === "date" && o.date ? `on ${o.date}` : "",
    o.where === "any" ? "anywhere in Zim" : "",
  ].filter(Boolean).join(", ");
  let r = await send(phone, { text: extra ? `${o.text}, ${extra}` : o.text }, wait);
  if (has(r, phone, /cat:more/)) r = await send(phone, { reply: `cat:${o.cat}` }, wait);
  return r;
}

async function main(): Promise<void> {
  await new Promise<void>((r) => graph.listen(GRAPH_PORT, r));
  const bot = spawn("node_modules/.bin/tsx", ["src/server.ts"], {
    detached: true,
    env: {
      ...process.env,
      PORT: String(BOT_PORT),
      WA_TOKEN: "sim",
      WA_PHONE_NUMBER_ID: "123",
      WA_VERIFY_TOKEN: "sim",
      WA_APP_SECRET: "",
      GRAPH_BASE_URL: `http://localhost:${GRAPH_PORT}`,
      ADMIN_PHONE: ADMIN,
      PUBLIC_URL: "https://scoutly-demo.example",
      SIMULATED_PAY_SECONDS: "1",
      SAMPLE_REPLY_SECONDS: "1",
      SAMPLE_PROVIDERS: "true", // demo listings exist only in the simulator
      PAYNOW_INTEGRATION_ID: "",
      MEDIA_DIR: "/tmp/scoutly-sim-media",
      POSTHOG_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  bot.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${BOT_PORT}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }

  try {
    // ---- photos are served for the cards
    const img = await fetch(`http://localhost:${BOT_PORT}/img/np300.jpg`);
    check(img.ok && img.headers.get("content-type") === "image/jpeg", "demo photos are served at /img/…");
    check((await fetch(`http://localhost:${BOT_PORT}/img/..%2Fsrc%2Fbot.ts`)).status === 404, "only demo photos can be fetched");

    // ---- a buyer looking for a car gets swipeable cards: new and pre-loved, cheapest first, plus a sponsored card
    await onboard(CUSTOMER, "Sizwe");
    let r = await post(CUSTOMER, { text: "Looking for a car under $9,000", kind: "item", cat: "cars", budget: "$9,000", when: "week" });
    const carousel = r.find((m) => m.to === CUSTOMER && m.type === "carousel");
    check(Boolean(carousel), "results come as a swipeable carousel");
    check(Boolean(carousel && /BMW 7 Series 745i · \$5,500 · Pre-loved · 📍 Bulawayo · delivers anywhere · Seller: 🥉 Bronze/.test(carousel.options[0] ?? "") && /Nissan NP300 single cab · \$8,500/.test(carousel.options[1] ?? "")), "cards show photo, price and condition, cheapest first");
    check(Boolean(carousel && /bmw745\.jpg/.test(carousel.options[0] ?? "")), "the BMW card uses its real photo");
    check(Boolean(carousel && /^adtap:AD-\d+ · Sponsored · Kudu Car Cover/.test(carousel.options.at(-1) ?? "")), "the last card is a labelled sponsored ad (complementary: insurance for cars)");
    check(has(r, CUSTOMER, /Swapping numbers uses 1 credit \(you have 3\)/) && has(r, CUSTOMER, /alert:on:N-1001/), "explains the swap cost (1 credit for everything) and offers alerts");
    const npCard = option(r, CUSTOMER, /^int:O-\d+:N-1001(?= · Nissan)/);

    // ---- tapping a sponsored card shares the advertiser's contact
    r = await send(CUSTOMER, { reply: option(r, CUSTOMER, /^adtap:AD-\d+/) });
    check(has(r, CUSTOMER, /Kudu Car Cover[\s\S]*wa\.me\/263000000021[\s\S]*only connects you/), "sponsored tap gives the advertiser's contact");

    // ---- interest in the bakkie: credits held, sample seller accepts, numbers swapped, "found it?" closes the post
    r = await send(CUSTOMER, { reply: npCard });
    check(has(r, CUSTOMER, /asked Busi M\.[\s\S]*1 credit on hold/), "buyer's credit is held while the seller decides");
    await sleep(1300);
    r = flush();
    check(has(r, CUSTOMER, /connected with Busi M\.\*[\s\S]*Nissan NP300 single cab · \$8,500[\s\S]*Wanted: This week[\s\S]*1 credit used\. Balance: 2 credits/), "seller accepts: numbers swapped, credits spent, key facts shown");
    {
      const msg = r.find((m) => m.to === CUSTOMER && /Tap to chat/.test(m.body ?? ""))?.body ?? "";
      const code = msg.match(/https:\/\/scoutly-demo\.example\/c\/([A-Za-z0-9]{10})\b/)?.[1];
      check(Boolean(code) && !/wa\.me/.test(msg), "chat link is short (no long wa.me link in the message)");
      const res = await fetch(`http://localhost:${BOT_PORT}/c/${code}`, { redirect: "manual" });
      const to = res.headers.get("location") ?? "";
      check(res.status === 302 && /wa\.me\/263000000012\?text=Hi%20Busi%20M\.%2C%20it's%20Sizwe[^ ]*Scoutly/.test(to), "short link opens the chat with the pre-typed Scoutly hello");
      check((await fetch(`http://localhost:${BOT_PORT}/c/AAAAAAAAAA`, { redirect: "manual" })).status === 404, "made-up short links go nowhere");
    }
    check(has(r, CUSTOMER, /found:yes:N-1001/), "asks whether they found what they needed");
    r = await send(CUSTOMER, { reply: "found:yes:N-1001" });
    check(has(r, CUSTOMER, /closed N-1001, so nobody else gets it/), "found it: post closed");

    // ---- a seller lists a fridge with a photo; a buyer with alerts on gets it straight away
    await onboard(BUYER2, "Rudo");
    r = await send(BUYER2, { text: "check https://cheapcars.example.com" });
    check(has(r, BUYER2, /doesn't accept links/), "links are refused");
    r = await send(BUYER2, { text: '{"type":"text","body":"hi"}' });
    check(has(r, BUYER2, /only read normal text/), "JSON input is refused");
    r = await send(BUYER2, { text: "call me on 0771234567" });
    check(has(r, BUYER2, /don't type phone numbers/), "phone numbers in messages are refused");
    r = await send(BUYER2, { text: "Panado and cough syrup for my child" });
    check(has(r, BUYER2, /licensed pharmacies[\s\S]*prescription/), "searching for medicine is allowed and goes to licensed pharmacies");
    await send(BUYER2, { text: "MENU" });
    r = await send(BUYER2, { reply: "menu:sell" });
    r = await send(BUYER2, { reply: "kind:item" });
    r = await send(BUYER2, { reply: "cat:pharmacy" });
    check(has(r, BUYER2, /Only \*licensed pharmacies\* can list medicines/), "a non-pharmacy can't open the medicines category to sell");
    r = await send(BUYER2, { text: "PHARMACY" });
    check(has(r, BUYER2, /Apply as a licensed pharmacy/), "PHARMACY starts an application");
    r = await send(BUYER2, { text: "Rudo Pharmacy, 12 Fife Street Bulawayo, MCAZ licence P1234, pharmacist R. Moyo" });
    check(has(r, BUYER2, /check your licence/) && has(r, ADMIN, /Pharmacy application/) && has(r, ADMIN, /pharm:ok:/), "application goes to admin with Approve/Reject");
    r = await send(ADMIN, { reply: option(r, ADMIN, /^pharm:ok:\d+/) });
    check(has(r, BUYER2, /approved as a \*licensed pharmacy\*/), "admin approves the pharmacy");
    await send(BUYER2, { text: "MENU" });
    r = await post(BUYER2, { text: "fridge", kind: "item", cat: "appliances", budget: "$350", when: "flexible" });
    check(has(r, BUYER2, /\[photo fridge\.jpg\][\s\S]*Defy combi fridge[\s\S]*\$520 · New/), "one match comes as a single picture card (new Defy fridge)");
    r = await send(BUYER2, { reply: "alert:on:N-1003" });
    check(has(r, BUYER2, /We'll message you when a new match/), "alerts are opt-in");

    await onboard(PROVIDER, "Joe", "sell");
    await send(PROVIDER, { reply: "menu:sell" });
    r = await send(PROVIDER, { reply: "kind:item" });
    check(has(r, PROVIDER, /cat:appliances/), "seller picks an item category");
    await send(PROVIDER, { reply: "cat:appliances" });
    await send(PROVIDER, { text: "Hisense fridge 200L" });
    await send(PROVIDER, { text: "Works perfectly, 2 years old, moving house." });
    r = await send(PROVIDER, { reply: "cond:good" });
    check(has(r, PROVIDER, /price in US dollars/), "asks the price");
    r = await send(PROVIDER, { text: "abc" });
    check(has(r, PROVIDER, /Type the price in US dollars/), "rejects a price that isn't a number");
    r = await send(PROVIDER, { text: "$300" });
    check(has(r, PROVIDER, /Send up to 3 photos/), "asks for photos");
    r = await send(PROVIDER, { image: "media-1" }, 700);
    check(has(r, PROVIDER, /Photo 1 saved/), "photo downloaded and saved");
    await send(PROVIDER, { reply: "photos:done" });
    r = await send(PROVIDER, { reply: "cover:city" });
    check(has(r, PROVIDER, /\[photo [a-f0-9-]{36}\.jpg\][\s\S]*Check your listing[\s\S]*Pre-loved · good[\s\S]*\$300\n[\s\S]*Listing score: 80%/), "summary shows the seller's photo and a listing score");
    r = await send(PROVIDER, { reply: "list:post" });
    check(has(r, PROVIDER, /You're listed/), "listed");
    const alertCard = option(r, BUYER2, /^int:O-\d+:N-1003/);
    check(has(r, BUYER2, /New match\* for your post "fridge[\s\S]*Hisense fridge 200L[\s\S]*\$300 · Pre-loved/) && Boolean(alertCard), "buyer with alerts gets the new fridge instantly");

    // ---- buyer interested → real seller accepts → swap
    r = await send(BUYER2, { reply: alertCard });
    const sellYes = option(r, PROVIDER, /^sell:yes:L\d+/);
    check(has(r, PROVIDER, /Rudo is interested\* in your Hisense fridge 200L \(\$300\)[\s\S]*Their budget: \$350/) && Boolean(sellYes), "seller sees the buyer's budget before accepting");
    r = await send(PROVIDER, { reply: sellYes });
    check(has(r, BUYER2, /connected with Joe[\s\S]*\+263 78 222 2222/) && has(r, PROVIDER, /New customer: Rudo[\s\S]*\+263 78 444 4444[\s\S]*Balance: 2 credits/), "both get each other's number; each used 1 credit");

    // ---- mark as sold
    await send(PROVIDER, { reply: "menu:posts" });
    r = await send(PROVIDER, { reply: "post:list:O-516" });
    check(has(r, PROVIDER, /sold:O-516/), "seller can mark the item as sold");
    r = await send(PROVIDER, { reply: "sold:O-516" });
    check(has(r, PROVIDER, /Marked as sold/), "item marked as sold");

    // ---- Joe also offers painting; a buyer posts a dated painting job and compares quotes
    await send(PROVIDER, { reply: "menu:sell" });
    await send(PROVIDER, { reply: "kind:service" });
    await send(PROVIDER, { reply: "cat:painting" });
    await send(PROVIDER, { text: "Painter. Interior and exterior, Dulux, fix and supply." });
    await send(PROVIDER, { text: "From $55 a room" });
    await send(PROVIDER, { reply: "photos:skip" });
    await send(PROVIDER, { reply: "cover:city" });
    await send(PROVIDER, { reply: "list:post" });

    r = await post(BUYER2, { text: "Painter for 6 rooms 200m2 Dulux fix and supply", kind: "service", cat: "painting", when: "date", date: "Sat 20 Dec, 9am" });
    check(has(r, BUYER2, /sent it to 2 providers \(builders and painters\)/), "service post goes to 2 painters");
    check(has(r, BUYER2, /Sponsored\*[\s\S]*Ace Paint Centre/), "complementary sponsored card: a paint shop for a painting job");
    const joeLead = option(r, PROVIDER, /^lead:yes:L\d+/);
    check(has(r, PROVIDER, /New job · Building & painting[\s\S]*Sat 20 Dec, 9am/) && Boolean(joeLead), "painter gets the job with the date");
    await sleep(1300);
    r = flush();
    check(has(r, BUYER2, /Sipho Painters\* sent a quote[\s\S]*\$850, paint included, 4 days/), "sample painter quotes $850");
    r = await send(PROVIDER, { reply: joeLead });
    check(has(r, PROVIDER, /Type your price and timing/), "Joe is asked for a quote");
    r = await send(PROVIDER, { text: "$780, paint included, 3 days" });
    check(has(r, BUYER2, /Joe\* sent a quote[\s\S]*\$780/), "Joe's quote reaches the buyer");
    const compare = r.find((m) => m.to === BUYER2 && /quotes so far/.test(m.body));
    check(Boolean(compare && /Joe/.test(compare.options[0] ?? "") && /Sipho/.test(compare.options[1] ?? "")), "compare list shows quotes cheapest first (Joe $780, then Sipho $850)");
    r = await send(BUYER2, { reply: option(r, BUYER2, /^conn:yes:L\d+/) });
    check(has(r, BUYER2, /connected with Joe/) && has(r, PROVIDER, /New customer: Rudo[\s\S]*Painter for 6 rooms/), "buyer swaps numbers with the cheapest painter");

    // ---- stars only rating
    await send(BUYER2, { reply: "menu:posts" });
    await send(BUYER2, { reply: "post:need:N-1004" });
    r = await send(BUYER2, { reply: "rate:N-1004" });
    r = await send(BUYER2, { reply: option(r, BUYER2, /^rating:L\d+:5/) });
    check(has(r, PROVIDER, /rated you 5\/5/), "rating saved and seller told");

    // ---- illegal posts are blocked and flagged
    await onboard(ADMIN, "Ann");
    r = await send(CUSTOMER, { text: "selling dagga cheap" });
    check(has(r, CUSTOMER, /can.t accept that[\s\S]*illegal goods/) && has(r, ADMIN, /Blocked[\s\S]*dagga/), "illegal post refused and admin alerted");

    // ---- self-serve ad → admin approves → live
    await send(PROVIDER, { reply: "menu:ads" });
    r = await send(PROVIDER, { reply: "adnew" });
    await send(PROVIDER, { reply: "kind:service" });
    await send(PROVIDER, { reply: "cat:carpentry" });
    await send(PROVIDER, { text: "Joe's Paints: 10% off for carpenters' clients this December" });
    await send(PROVIDER, { reply: "photos:skip" });
    await send(PROVIDER, { reply: "where:city" });
    r = await send(PROVIDER, { reply: "ad:submit" });
    const approve = option(r, ADMIN, /^ad:ok:AD-\d+/);
    check(has(r, PROVIDER, /sent for approval/) && Boolean(approve), "ad goes to the admin for approval");
    r = await send(ADMIN, { reply: approve });
    check(has(r, PROVIDER, /is live/), "approved ad goes live");
    r = await send(CUSTOMER, { reply: approve });
    check(has(r, CUSTOMER, /didn't get that/), "only the admin can approve ads");

    // ---- admin commands
    r = await send(ADMIN, { text: "lookup N-1004" });
    check(has(r, ADMIN, /N-1004[\s\S]*Rudo \+263 78 444 4444[\s\S]*CONNECTED: Joe \+263 78 222 2222/), "LOOKUP shows both sides' numbers");
    r = await send(ADMIN, { text: "GRANT 0771234567 5" });
    check(has(r, ADMIN, /Gave 5 credits to Sizwe/) && has(r, CUSTOMER, /received 5 credits/), "GRANT tops up credits");
    r = await send(ADMIN, { text: "verify 0782222222" });
    check(has(r, PROVIDER, /verified seller/), "VERIFY gives the ✅ badge");
    r = await send(ADMIN, { reply: "menu:credits" });
    check(has(r, ADMIN, /buy:test1 "🧪 1 credit · \$0\.50"/), "admin sees the 50c test bundle");
    r = await send(ADMIN, { reply: "buy:test1" });
    check(has(r, ADMIN, /Pay \*\$0\.50\* for 1 credit/), "admin can start a 50c test payment");
    await send(ADMIN, { text: "MENU" });
    r = await send(ADMIN, { text: "STATS" });
    check(has(r, ADMIN, /Swapped: 3[\s\S]*Ads: 3 live/), "STATS adds up");

    // ---- buying credits (simulated EcoCash)
    r = await send(BUYER2, { reply: "menu:credits" });
    check(has(r, BUYER2, /2 credits · \$1\.00/) && has(r, BUYER2, /7 credits · \$3\.00/) && has(r, BUYER2, /13 credits · \$5\.00/), "bundles are $1, $3 and $5");
    check(has(r, BUYER2, /3 credits every week \(Monday\)\. Unused free credits don.t carry over/), "credits screen explains the weekly free credits");
    await send(BUYER2, { reply: "buy:b2" });
    r = await send(BUYER2, { reply: "pay:self" });
    check(has(r, BUYER2, /enter your PIN/), "EcoCash prompt sent");
    await sleep(2500);
    r = flush();
    check(has(r, BUYER2, /Payment received[\s\S]*\+2 credits/), "credits added only after payment confirms");

    // ---- one-message search (tester feedback): no repeat questions, quick edits after the results
    r = await send(CUSTOMER, { text: "I'm looking for a pre-loved fridge with a budget of $100" });
    check(!has(r, CUSTOMER, /kind:item/) && !has(r, CUSTOMER, /What's your budget/) && has(r, CUSTOMER, /Fridges & appliances · up to \$100 · Bulawayo/), "one message is enough: category and budget read from the text");
    let edit = option(r, CUSTOMER, /^edit:menu:N-\d+/);
    r = await send(CUSTOMER, { reply: edit });
    check(has(r, CUSTOMER, /edit:budget:/) && has(r, CUSTOMER, /edit:any:/) && has(r, CUSTOMER, /edit:cat:/), "Edit search offers budget, town and category");
    r = await send(CUSTOMER, { reply: option(r, CUSTOMER, /^edit:any:N-\d+/) });
    check(has(r, CUSTOMER, /up to \$100 · anywhere in Zim/), "search all of Zimbabwe re-runs the search");
    edit = option(r, CUSTOMER, /^edit:menu:N-\d+/);
    r = await send(CUSTOMER, { reply: edit });
    await send(CUSTOMER, { reply: option(r, CUSTOMER, /^edit:budget:N-\d+/) });
    r = await send(CUSTOMER, { text: "$600" });
    check(has(r, CUSTOMER, /Defy combi fridge/) && has(r, CUSTOMER, /up to \$600/), "changing the budget re-runs the search");
    r = await send(CUSTOMER, { text: "something nice for my mom" });
    check(has(r, CUSTOMER, /cat:more/) && !has(r, CUSTOMER, /kind:item/), "only asks the category when it can't tell (no item-or-service step)");
    r = await send(CUSTOMER, { reply: "cat:more" });
    check(has(r, CUSTOMER, /cat:fashion/), "More categories shows the rest");
    r = await send(CUSTOMER, { reply: "cat:fashion" });
    check(has(r, CUSTOMER, /Clothes & shoes · Bulawayo/) && !has(r, CUSTOMER, /What's your budget/), "after picking the category it goes straight to results");

    // ---- Joshua's "fuel saver" search (22 Nov screenshots): understood straight away, no robotic echo
    r = await send(CUSTOMER, { text: "Looking for a fuel saver budget 4000" });
    check(!has(r, CUSTOMER, /kind:item/) && has(r, CUSTOMER, /Cars & bakkies · up to \$4,000 · Bulawayo/), "local words: 'fuel saver' goes straight to Cars with the budget");
    check(!has(r, CUSTOMER, /Looking for "Looking for/), "no robotic repeat of the whole message");
    r = await send(CUSTOMER, { text: "I need a gazebo for my garden party, budget $200" });
    check(has(r, CUSTOMER, /Which category is \*a gazebo for my garden party\* in\?/) && has(r, CUSTOMER, /cat:more/) && !has(r, CUSTOMER, /kind:item/), "unclear search: one category question, no item-or-service step");
    await send(CUSTOMER, { text: "MENU" });

    // ---- Selling a car: year required, mileage asked, at least 1 photo required
    await send(PROVIDER, { text: "MENU" });
    await send(PROVIDER, { reply: "menu:sell" });
    await send(PROVIDER, { reply: "kind:item" });
    r = await send(PROVIDER, { reply: "cat:cars" });
    check(has(r, PROVIDER, /year, make and model/), "car listing asks for year, make and model");
    r = await send(PROVIDER, { text: "Honda Fit" });
    check(has(r, PROVIDER, /Please include the \*year\*/), "a car without a year is sent back");
    r = await send(PROVIDER, { text: "2014 Honda Fit" });
    check(has(r, PROVIDER, /mileage/), "asks the mileage");
    r = await send(PROVIDER, { text: "98k" });
    await send(PROVIDER, { reply: "desc:skip" });
    await send(PROVIDER, { reply: "cond:good" });
    r = await send(PROVIDER, { text: "3500" });
    check(has(r, PROVIDER, /At least 1 photo is needed/) && !has(r, PROVIDER, /photos:skip/), "cars must have a photo (no skip button)");
    r = await send(PROVIDER, { reply: "photos:done" });
    check(has(r, PROVIDER, /need at least \*1 photo\*/), "Done without a photo is refused for cars");
    await send(PROVIDER, { image: "media-7" }, 700);
    await send(PROVIDER, { reply: "photos:done" });
    r = await send(PROVIDER, { reply: "cover:all" });
    check(has(r, PROVIDER, /2014 Honda Fit · 98,000 km/), "listing summary shows the mileage");
    await send(PROVIDER, { reply: "list:post" });
    r = await send(CUSTOMER, { text: "honda fit under $4000" });
    check(has(r, CUSTOMER, /2014 Honda Fit · 98,000 km[\s\S]*\$3,500 · Pre-loved · 📍 Bulawayo · delivers anywhere/), "car card shows year, model, mileage and the seller's town");

    // ---- An item with no photo gets a tidy category card, and badges talk about the seller
    await send(PROVIDER, { text: "MENU" });
    await send(PROVIDER, { reply: "menu:sell" });
    await send(PROVIDER, { reply: "kind:item" });
    await send(PROVIDER, { reply: "cat:furniture" });
    await send(PROVIDER, { text: "Three seater sofa, grey" });
    await send(PROVIDER, { reply: "desc:skip" });
    await send(PROVIDER, { reply: "cond:used" });
    await send(PROVIDER, { text: "120" });
    await send(PROVIDER, { reply: "photos:skip" });
    await send(PROVIDER, { reply: "cover:city" });
    await send(PROVIDER, { reply: "list:post" });
    r = await send(CUSTOMER, { text: "sofa under $150" });
    check(has(r, CUSTOMER, /\[photo ph-furniture\.jpg\]/) && !has(r, CUSTOMER, /no-photo\.jpg/), "no photo: a Scoutly category card, not a big empty box");
    check(has(r, CUSTOMER, /Seller: (🆕 new on Scoutly|🥉 Bronze)/) && !has(r, CUSTOMER, /🆕 New · ⭐ New/), "badges clearly describe the seller, not the item");
    check(has(r, CUSTOMER, /1 match so far\. Tap \*🔔 Alert me\*/), "one result: honest wording that leads with Alert me");
    await send(CUSTOMER, { text: "MENU" });

    // ---- greetings: hi, hie, hey, howzit all open the menu; no "anything else?" after actions
    for (const g of ["Hie", "hiee", "Hey", "howzit", "Good morning"]) {
      r = await send(CUSTOMER, { text: g });
      check(has(r, CUSTOMER, /Hi Sizwe 👋/), `"${g}" opens the menu`);
    }

    // ---- 50c test bundle: admin only
    r = await send(CUSTOMER, { reply: "menu:credits" });
    check(!has(r, CUSTOMER, /buy:test1/), "normal users don't see the 50c test bundle");
    r = await send(CUSTOMER, { reply: "buy:test1" });
    check(!has(r, CUSTOMER, /Pay \*\$0\.50\*/), "normal users can't buy the test bundle even by its ID");
    await send(CUSTOMER, { text: "MENU" });

    // ---- How it works explains credits and number-sharing consent
    r = await send(CUSTOMER, { reply: "menu:help" });
    check(has(r, CUSTOMER, /How credits work[\s\S]*1 credit = 1 number swap[\s\S]*on hold[\s\S]*you get it back[\s\S]*\$1 = 2 credits · \$3 = 7 credits · \$5 = 13 credits/), "How it works explains credits, holds, refunds and bundles");
    check(has(r, CUSTOMER, /share your phone number with another person \*only when you both agree\*/), "How it works states the number-sharing consent");
    check(!has(r, CUSTOMER, /3 for cars/), "no outdated car pricing");

    // ---- menu works in any capitals, unknown taps re-prompt
    r = await send(CUSTOMER, { text: "MeNu" });
    check(has(r, CUSTOMER, /menu:find/), "MENU works in any capitals");
    r = await send(CUSTOMER, { reply: "bogus:thing" });
    check(has(r, CUSTOMER, /didn't get that/), "unknown taps get a friendly re-prompt");

    const failed = process.exitCode === 1;
    console.log(failed ? "\n✘ Some checks failed" : "\n✔ All checks passed");
  } finally {
    try {
      process.kill(-bot.pid!, "SIGTERM");
    } catch {
      bot.kill("SIGTERM");
    }
    graph.close();
  }
}

void main();
