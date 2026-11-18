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
      if (i?.type === "carousel") {
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

async function send(from: string, what: { text?: string; reply?: string }, wait = 400): Promise<Sent[]> {
  const who = NAMES[from] ?? from;
  console.log(`\n▶ ${who} ${what.text !== undefined ? `types "${what.text}"` : `taps ${what.reply}`}`);
  const message = what.text !== undefined
    ? { from, id: `sim${++msgId}`, type: "text", text: { body: what.text } }
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

/** Finds the first option id matching a pattern in messages to one phone, e.g. lead:yes:L3. */
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

async function onboard(phone: string, name: string, area: string): Promise<Sent[]> {
  let r = await send(phone, { text: "hi" });
  check(has(r, phone, /consent:yes/), `${name}: asks for consent first`);
  await send(phone, { reply: "consent:yes" });
  r = await send(phone, { text: name });
  check(has(r, phone, /area:west/), `${name}: asks for their area`);
  r = await send(phone, { reply: `area:${area}` });
  check(has(r, phone, /You have 3 free credits/), `${name}: gets 3 free credits on sign-up`);
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
      PAYNOW_INTEGRATION_ID: "",
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
    // ---- a carpenter lists himself
    let r = await onboard(PROVIDER, "Joe", "west");
    check(has(r, PROVIDER, /menu:offer/), "menu offers 'I offer or sell'");
    await send(PROVIDER, { reply: "menu:offer" });
    r = await send(PROVIDER, { reply: "cat:carpentry" });
    check(has(r, PROVIDER, /Describe what you sell or the service you offer/), "asks what he sells or offers");
    await send(PROVIDER, { text: "Carpenter. Wardrobes, doors and kitchen units." });
    r = await send(PROVIDER, { reply: "cover:all" });
    check(has(r, PROVIDER, /price:skip/), "asks for an optional price");
    r = await send(PROVIDER, { text: "From $15 call-out" });
    check(has(r, PROVIDER, /Check your listing[\s\S]*From \$15/), "shows the listing to check");
    r = await send(PROVIDER, { reply: "offer:post" });
    check(has(r, PROVIDER, /You're listed[\s\S]*buyers? accepts?[\s\S]*|You're listed[\s\S]*You have 3 credits/), "listed, balance shown");

    // ---- a customer just types what they need
    r = await onboard(CUSTOMER, "Sizwe", "west");
    r = await send(CUSTOMER, { text: "My wardrobe door is broken" });
    check(has(r, CUSTOMER, /Looking for "My wardrobe door is broken"/) && has(r, CUSTOMER, /cat:carpentry/), "typing at the menu starts a post");
    r = await send(CUSTOMER, { reply: "cat:carpentry" });
    check(has(r, CUSTOMER, /when:week/), "skips the description (already typed) and asks when");
    r = await send(CUSTOMER, { reply: "when:week" });
    check(has(r, CUSTOMER, /What's your budget\?/) && has(r, CUSTOMER, /budget:skip/), "asks the budget");
    r = await send(CUSTOMER, { text: "$40" });
    check(has(r, CUSTOMER, /Check your post[\s\S]*Western suburbs[\s\S]*Budget: \$40/), "shows the post to check, with budget");
    r = await send(CUSTOMER, { reply: "need:post" }, 300);
    check(has(r, CUSTOMER, /sent it to 2 carpenters/), "sent to Joe and the sample carpenter who covers the west");
    const joeLead = option(r, PROVIDER, /^lead:yes:L\d+/);
    check(Boolean(joeLead) && has(r, PROVIDER, /New lead · Carpentry[\s\S]*wardrobe door[\s\S]*Budget: \$40[\s\S]*3 credits/), "Joe gets the lead with the budget and his balance");
    check(!has(r, CUSTOMER, /\+263/), "customer's number is not shared yet");

    // ---- the sample provider replies on its own
    await sleep(1300);
    r = flush();
    const thaboConn = option(r, CUSTOMER, /^conn:no:L\d+/);
    check(has(r, CUSTOMER, /Thabo M\.\* can help[\s\S]*⭐ 4\.7/) && has(r, CUSTOMER, /Sample provider for the demo/), "sample provider introduces himself with rating");

    // ---- Joe is interested
    r = await send(PROVIDER, { reply: joeLead });
    check(has(r, PROVIDER, /sent your profile[\s\S]*on hold/), "Joe's credit is held, not spent");
    const joeConn = option(r, CUSTOMER, /^conn:yes:L\d+/);
    check(has(r, CUSTOMER, /Joe\* can help[\s\S]*From \$15/) && Boolean(joeConn), "customer sees Joe's profile");
    r = await send(PROVIDER, { reply: joeLead });
    check(has(r, PROVIDER, /already said you're interested/), "tapping twice does nothing");

    // ---- customer swaps numbers with Joe, says no to Thabo
    r = await send(CUSTOMER, { reply: joeConn });
    check(has(r, CUSTOMER, /connected with Joe[\s\S]*\+263 78 222 2222[\s\S]*wa\.me\/263782222222[\s\S]*1 credit used\. Balance: 2 credits[\s\S]*only connects you/), "customer gets Joe's number, pays 1 credit, sees the no-liability line");
    check(has(r, PROVIDER, /New customer: Sizwe[\s\S]*\+263 77 123 4567[\s\S]*Budget: \$40[\s\S]*Balance: 2 credits[\s\S]*only connects you/), "Joe gets the customer's number, 1 credit used, no-liability line");
    r = await send(CUSTOMER, { reply: thaboConn });
    check(has(r, CUSTOMER, /won't share your number with Thabo/), "saying no keeps the number private");

    // ---- nobody offers this yet; a new provider joins later and gets it
    await send(CUSTOMER, { reply: "menu:need" });
    await send(CUSTOMER, { reply: "cat:beauty" });
    await send(CUSTOMER, { text: "Braids at home on Saturday" });
    await send(CUSTOMER, { reply: "when:today" });
    await send(CUSTOMER, { reply: "budget:skip" });
    r = await send(CUSTOMER, { reply: "need:post" });
    check(has(r, CUSTOMER, /No hair and beauty pros near you are listed yet/), "no match: post stays open");
    r = await onboard(ADMIN, "Ann", "east");
    await send(ADMIN, { reply: "menu:offer" });
    await send(ADMIN, { reply: "cat:beauty" });
    await send(ADMIN, { text: "Braids and nails. I come to you." });
    await send(ADMIN, { reply: "cover:all" });
    await send(ADMIN, { reply: "price:skip" });
    r = await send(ADMIN, { reply: "offer:post" });
    const annLead = option(r, ADMIN, /^lead:yes:L\d+/);
    check(has(r, ADMIN, /1 job already waiting/) && Boolean(annLead), "new provider gets the waiting post");
    r = await send(ADMIN, { reply: annLead });
    const report = option(r, CUSTOMER, /^report:L\d+/);
    check(Boolean(report), "customer sees Ann's profile with a Report button");
    r = await send(CUSTOMER, { reply: report });
    check(has(r, CUSTOMER, /won't share your number with Ann/), "report keeps the number private");
    check(has(r, ADMIN, /Report\* on lead[\s\S]*strikes 1\/3/), "admin gets the report");

    // ---- rate Joe from My posts
    r = await send(CUSTOMER, { reply: "menu:posts" });
    const needPost = option(r, CUSTOMER, /^post:need:N-\d+/);
    check(has(r, CUSTOMER, /1 contact/), "My posts shows the contacts count");
    r = await send(CUSTOMER, { reply: "post:need:N-1001" });
    check(has(r, CUSTOMER, /rate:N-1001/) && has(r, CUSTOMER, /Contacts: Joe/), "post shows who you're connected with");
    r = await send(CUSTOMER, { reply: "rate:N-1001" });
    const five = option(r, CUSTOMER, /^rating:L\d+:5/);
    r = await send(CUSTOMER, { reply: five });
    check(has(r, CUSTOMER, /gave Joe 5\/5/) && has(r, PROVIDER, /rated you 5\/5[\s\S]*5\.0 from 1 review/), "rating saved and Joe is told");
    r = await send(CUSTOMER, { reply: five });
    check(has(r, CUSTOMER, /already rated/), "can't rate twice");
    void needPost;

    // ---- you never get a lead for your own post
    r = await send(PROVIDER, { text: "Kitchen cupboard doors fitted" });
    await send(PROVIDER, { reply: "cat:carpentry" });
    await send(PROVIDER, { reply: "when:flexible" });
    await send(PROVIDER, { reply: "budget:skip" });
    r = await send(PROVIDER, { reply: "need:post" });
    check(has(r, PROVIDER, /sent it to 1 carpenter /) && !has(r, PROVIDER, /New lead/), "own post goes to others only (singular wording)");

    // ---- Joe buys credits (simulated EcoCash)
    r = await send(PROVIDER, { reply: "menu:credits" });
    check(has(r, PROVIDER, /You have \*2 credits\*/) && has(r, PROVIDER, /buy:b5/), "credits screen shows balance and bundles");
    r = await send(PROVIDER, { reply: "buy:b5" });
    check(has(r, PROVIDER, /Pay \*\$2\.00\* for 5 credits with EcoCash from 0782 222 222/), "confirms amount and EcoCash number");
    r = await send(PROVIDER, { reply: "pay:self" });
    check(has(r, PROVIDER, /enter your PIN[\s\S]*Demo mode/), "payment prompt sent");
    r = await send(PROVIDER, { text: "menu" });
    check(has(r, PROVIDER, /still waiting for your payment/), "can't wander off mid-payment");
    await sleep(2500);
    r = flush();
    check(has(r, PROVIDER, /Payment received[\s\S]*\+5 credits[\s\S]*Balance: \*7 credits\*/), "credits added only after payment confirms");

    // ---- a buyer who runs out of credits pays, and the swap happens straight after
    await onboard(BUYER2, "Rudo", "south");
    for (let i = 1; i <= 4; i++) {
      await send(BUYER2, { text: `Blocked kitchen drain number ${i}` });
      await send(BUYER2, { reply: "cat:plumbing" });
      await send(BUYER2, { reply: "when:today" });
      await send(BUYER2, { text: "$20" });
      await send(BUYER2, { reply: "need:post" });
      await sleep(1300);
      r = flush();
      const yes = option(r, BUYER2, /^conn:yes:L\d+/);
      r = await send(BUYER2, { reply: yes });
      if (i < 4) continue;
      check(has(r, BUYER2, /You need 1 credit to swap numbers with Brian Plumbing/) && !has(r, BUYER2, /You're connected/), "4th swap waits for credits (3 free used)");
      await send(BUYER2, { reply: "menu:credits" });
      await send(BUYER2, { reply: "buy:b2" });
      await send(BUYER2, { reply: "pay:self" });
      await sleep(2500);
      r = flush();
      check(has(r, BUYER2, /Payment received/) && has(r, BUYER2, /You're connected with Brian Plumbing[\s\S]*Balance: 1 credit\./), "after paying, the swap goes through by itself");
    }

    // ---- odd input and admin stats
    r = await send(CUSTOMER, { reply: "bogus:thing" });
    check(has(r, CUSTOMER, /didn't get that/), "unknown taps get a friendly re-prompt");
    r = await send(ADMIN, { text: "STATS" });
    check(has(r, ADMIN, /Connected: 5[\s\S]*Credits sold: 7 \(\$3\.00\)/), "admin STATS adds up");

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
