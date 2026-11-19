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

async function onboard(phone: string, name: string): Promise<Sent[]> {
  let r = await send(phone, { text: "hi" });
  check(has(r, phone, /consent:yes/) && has(r, phone, /no illegal goods/) && has(r, phone, /aren't responsible/), `${name}: consent shows the rules and no-liability clause`);
  await send(phone, { reply: "consent:yes" });
  r = await send(phone, { text: name });
  check(has(r, phone, /city:byo/), `${name}: asks for their town`);
  r = await send(phone, { reply: "city:byo" });
  check(has(r, phone, /You have 3 free credits/), `${name}: 3 free credits on sign-up`);
  return r;
}

/** Posts a need from the menu, start to finish. */
async function post(phone: string, o: { text: string; kind: "item" | "service"; cat: string; budget?: string; when: string; date?: string; where?: "city" | "any" }, wait = 400): Promise<Sent[]> {
  await send(phone, { text: o.text });
  await send(phone, { reply: `kind:${o.kind}` });
  await send(phone, { reply: `cat:${o.cat}` });
  await send(phone, o.budget ? { text: o.budget } : { reply: "budget:skip" });
  await send(phone, { reply: `when:${o.when}` });
  if (o.date) await send(phone, { text: o.date });
  await send(phone, { reply: `where:${o.where ?? "city"}` });
  return send(phone, { reply: "need:post" }, wait);
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
    check(Boolean(carousel && /BMW 7 Series 745i · \$5,500 · Pre-loved · Nationwide/.test(carousel.options[0] ?? "") && /Nissan NP300 single cab · \$8,500/.test(carousel.options[1] ?? "")), "cards show photo, price and condition, cheapest first");
    check(Boolean(carousel && /bmw745\.jpg/.test(carousel.options[0] ?? "")), "the BMW card uses its real photo");
    check(Boolean(carousel && /^adtap:AD-\d+ · Sponsored · Kudu Car Cover/.test(carousel.options.at(-1) ?? "")), "the last card is a labelled sponsored ad (complementary: insurance for cars)");
    check(has(r, CUSTOMER, /Swapping numbers uses 3 credits \(you have 3\)/) && has(r, CUSTOMER, /alert:on:N-1001/), "explains the car swap cost and offers alerts");
    const npCard = option(r, CUSTOMER, /^int:O-\d+:N-1001(?= · Nissan)/);

    // ---- tapping a sponsored card shares the advertiser's contact
    r = await send(CUSTOMER, { reply: option(r, CUSTOMER, /^adtap:AD-\d+/) });
    check(has(r, CUSTOMER, /Kudu Car Cover[\s\S]*wa\.me\/263000000021[\s\S]*only connects you/), "sponsored tap gives the advertiser's contact");

    // ---- interest in the bakkie: credits held, sample seller accepts, numbers swapped, "found it?" closes the post
    r = await send(CUSTOMER, { reply: npCard });
    check(has(r, CUSTOMER, /asked Busi M\.[\s\S]*3 credits on hold/), "buyer's 3 credits are held while the seller decides");
    await sleep(1300);
    r = flush();
    check(has(r, CUSTOMER, /connected with Busi M\.\* about the Nissan NP300 single cab \(\$8,500\)[\s\S]*3 credits used\. Balance: 0 credits/), "seller accepts: numbers swapped, credits spent");
    check(has(r, CUSTOMER, /found:yes:N-1001/), "asks whether they found what they needed");
    r = await send(CUSTOMER, { reply: "found:yes:N-1001" });
    check(has(r, CUSTOMER, /closed N-1001, so nobody else gets it/), "found it: post closed");

    // ---- a seller lists a fridge with a photo; a buyer with alerts on gets it straight away
    await onboard(BUYER2, "Rudo");
    r = await post(BUYER2, { text: "fridge", kind: "item", cat: "appliances", budget: "$350", when: "flexible" });
    check(has(r, BUYER2, /\[photo fridge\.jpg\][\s\S]*Defy combi fridge[\s\S]*\$520 · New/), "one match comes as a single picture card (new Defy fridge)");
    r = await send(BUYER2, { reply: "alert:on:N-1002" });
    check(has(r, BUYER2, /We'll message you when a new match/), "alerts are opt-in");

    await onboard(PROVIDER, "Joe");
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
    const alertCard = option(r, BUYER2, /^int:O-\d+:N-1002/);
    check(has(r, BUYER2, /New match\* for your post "fridge"[\s\S]*Hisense fridge 200L[\s\S]*\$300 · Pre-loved/) && Boolean(alertCard), "buyer with alerts gets the new fridge instantly");

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
    await send(BUYER2, { reply: "post:need:N-1003" });
    r = await send(BUYER2, { reply: "rate:N-1003" });
    r = await send(BUYER2, { reply: option(r, BUYER2, /^rating:L\d+:5/) });
    check(has(r, PROVIDER, /rated you 5\/5/), "rating saved and seller told");

    // ---- illegal posts are blocked and flagged
    await onboard(ADMIN, "Ann");
    r = await send(CUSTOMER, { text: "selling dagga cheap" });
    check(has(r, CUSTOMER, /can't post that/) && has(r, ADMIN, /Post blocked[\s\S]*dagga/), "illegal post refused and admin alerted");

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
    r = await send(ADMIN, { text: "lookup N-1003" });
    check(has(r, ADMIN, /N-1003[\s\S]*Rudo \+263 78 444 4444[\s\S]*CONNECTED: Joe \+263 78 222 2222/), "LOOKUP shows both sides' numbers");
    r = await send(ADMIN, { text: "GRANT 0771234567 5" });
    check(has(r, ADMIN, /Gave 5 credits to Sizwe/) && has(r, CUSTOMER, /received 5 credits/), "GRANT tops up credits");
    r = await send(ADMIN, { text: "verify 0782222222" });
    check(has(r, PROVIDER, /verified seller/), "VERIFY gives the ✅ badge");
    r = await send(ADMIN, { text: "STATS" });
    check(has(r, ADMIN, /Swapped: 3[\s\S]*Ads: 3 live/), "STATS adds up");

    // ---- buying credits (simulated EcoCash)
    r = await send(BUYER2, { reply: "menu:credits" });
    check(has(r, BUYER2, /buy:b5/) && !has(r, BUYER2, /\$1\.00/), "smallest bundle is $2");
    await send(BUYER2, { reply: "buy:b5" });
    r = await send(BUYER2, { reply: "pay:self" });
    check(has(r, BUYER2, /enter your PIN/), "EcoCash prompt sent");
    await sleep(2500);
    r = flush();
    check(has(r, BUYER2, /Payment received[\s\S]*\+5 credits/), "credits added only after payment confirms");

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
