// Runs a full demo through the real server with a fake WhatsApp API.
// No Meta account needed. Run: npm run simulate
// It prints what each phone would see.

import { spawn } from "node:child_process";
import { createServer } from "node:http";

const CUSTOMER = "263771234567";
const STAFF = "263772222222";
const GRAPH_PORT = 4999;
const BOT_PORT = 4998;

interface Sent {
  to: string;
  type: string;
  body: string;
  options: string[]; // button / row / card ids
}

const outbox: Sent[] = [];

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
        body = i.body.text;
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
  const who = from === STAFF ? "STAFF" : "CUSTOMER";
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
    const who = m.to === STAFF ? "  📱 staff sees" : "  📱 customer sees";
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
      STAFF_PHONE: STAFF,
      PUBLIC_URL: "https://greens-demo.example",
      SIMULATED_PAY_SECONDS: "1",
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
    let r = await send(CUSTOMER, { text: "hi" });
    check(has(r, CUSTOMER, /consent:yes/), "asks for consent first");
    await send(CUSTOMER, { reply: "consent:yes" });
    r = await send(CUSTOMER, { text: "Thandi" });
    check(has(r, CUSTOMER, /menu:shop/), "shows the menu");

    await send(CUSTOMER, { reply: "menu:shop" });
    r = await send(CUSTOMER, { reply: "cat:cupboard" });
    check(r.some((m) => m.type === "carousel"), "food & drinks show as picture cards");
    r = await send(CUSTOMER, { reply: "add:g04" });
    await send(CUSTOMER, { reply: "add:g04" });
    await send(CUSTOMER, { reply: "add:g05" });
    r = await send(CUSTOMER, { text: "omo" });
    check(has(r, CUSTOMER, /add:g07/), "typing a product name finds it");
    await send(CUSTOMER, { reply: "add:g07" });
    for (let i = 0; i < 3; i++) await send(CUSTOMER, { reply: "add:g02" }, 250);
    r = await send(CUSTOMER, { reply: "add:g02" });
    check(has(r, CUSTOMER, /limit of 3/), "per-order limit on potatoes");
    await send(CUSTOMER, { reply: "menu:edit" });
    for (let i = 0; i < 3; i++) await send(CUSTOMER, { reply: "rm:g02" }, 250);

    await send(CUSTOMER, { reply: "menu:cart" });
    await send(CUSTOMER, { reply: "menu:edit" });
    r = await send(CUSTOMER, { reply: "rm:g04" });
    check(has(r, CUSTOMER, /1 × Mazoe Orange Crush 2L/) && !has(r, CUSTOMER, /Potatoes/), "edit cart removes items");

    r = await send(CUSTOMER, { reply: "menu:checkout" });
    const firstSlot = r.flatMap((m) => m.options).find((o) => o.startsWith("slot:"))?.split(" ")[0];
    check(Boolean(firstSlot), "offers pickup times");
    r = await send(CUSTOMER, { reply: firstSlot ?? "" });
    check(has(r, CUSTOMER, /To pay \$11\.50/), "summary total is right ($4.00 + $3.50 + $4.00)");
    await send(CUSTOMER, { reply: "pay:now" });
    await send(CUSTOMER, { reply: "payer:self" }, 4200);
    r = outbox.slice(0, printed);
    const receipt = r.find((m) => m.to === CUSTOMER && /Pickup code/.test(m.body));
    check(Boolean(receipt), "receipt with pickup code arrives after payment");
    check(has(r, CUSTOMER, /\/qr\/[a-f0-9]{32}\.png/), "QR image is sent");
    check(has(r, STAFF, /New order \*GR-2041/), "staff get the packing list");
    const code = /Pickup code: \*(\d{3}) (\d{3})\*/.exec(receipt?.body ?? "");
    const pickupCode = code ? `${code[1]}${code[2]}` : "";
    const qrLink = r.flatMap((m) => /https:\/\/greens-demo\.example(\/qr\/\S+\.png)/.exec(m.body) ?? []).at(1);
    const qr = await fetch(`http://localhost:${BOT_PORT}${qrLink}`);
    check(qr.ok && qr.headers.get("content-type") === "image/png", "QR link serves a PNG");

    r = await send(CUSTOMER, { reply: "here:GR-2041" });
    check(has(r, CUSTOMER, /still being packed/), "'I'm here' before packing is handled");

    await send(STAFF, { reply: "missing:GR-2041" });
    r = await send(STAFF, { reply: "missing:GR-2041:g07" });
    check(has(r, CUSTOMER, /\$4\.00\* has been added to your Greens wallet/), "missing OMO credits $4.00 to the wallet");
    r = await send(STAFF, { text: pickupCode });
    check(has(r, STAFF, /isn't marked packed/), "code refused until packed");
    r = await send(STAFF, { reply: "pack:GR-2041" });
    check(has(r, CUSTOMER, /packed and waiting/), "customer told it's ready");

    r = await send(CUSTOMER, { reply: "here:GR-2041" });
    check(has(r, STAFF, /at the counter/), "staff alerted when customer arrives");
    r = await send(STAFF, { text: "000 000" });
    check(has(r, STAFF, /No order with that code/), "wrong code refused");
    r = await send(STAFF, { text: `${pickupCode.slice(0, 3)} ${pickupCode.slice(3)}` });
    check(has(r, STAFF, /Code valid/) && !has(r, STAFF, /☑️ 1 × OMO/), "right code accepted; OMO not in the hand-over list");
    r = await send(STAFF, { reply: "handover:GR-2041" });
    check(has(r, CUSTOMER, /Collected ✅/), "customer gets the collected message");
    r = await send(STAFF, { text: pickupCode });
    check(has(r, STAFF, /Code already used/), "the same code can't be used twice");
    check((await fetch(`http://localhost:${BOT_PORT}${qrLink}`)).status === 404, "QR link stops working after collection");

    r = await send(CUSTOMER, { reply: "menu:wallet" });
    check(has(r, CUSTOMER, /\$4\.00/), "wallet shows $4.00");
    r = await send(CUSTOMER, { reply: "menu:reorder" });
    check(has(r, CUSTOMER, /OMO Auto Liquid 750ml/), "reorder rebuilds the last basket");
    r = await send(CUSTOMER, { reply: "menu:checkout" });
    const slot2 = r.flatMap((m) => m.options).find((o) => o.startsWith("slot:"))?.split(" ")[0] ?? "";
    r = await send(CUSTOMER, { reply: slot2 });
    check(has(r, CUSTOMER, /Greens wallet −\$4\.00/), "wallet comes off the next order");
    await send(CUSTOMER, { reply: "pay:now" });
    await send(CUSTOMER, { reply: "payer:other" });
    r = await send(CUSTOMER, { text: "0712 345 678" });
    check(has(r, CUSTOMER, /isn't an EcoCash number/), "wrong network number is caught");
    await send(CUSTOMER, { text: "0789 645 899" }, 4200);
    r = outbox.slice(0, printed);
    check(has(r, CUSTOMER, /Paid: EcoCash \$7\.50 \+ wallet \$4\.00/), "receipt shows EcoCash + wallet split");

    r = await send(STAFF, { text: "orders" });
    check(has(r, STAFF, /GR-2042/), "staff can list open orders");
    r = await send(CUSTOMER, { text: "nonsenseword" });
    check(has(r, CUSTOMER, /couldn't find/), "unknown product gets a helpful reply");
  } finally {
    if (bot.pid) process.kill(-bot.pid, "SIGTERM");
    graph.closeAllConnections();
    graph.close();
  }
  console.log(process.exitCode ? "\n❌ Some checks failed." : "\n✅ All simulated checks passed.");
  process.exit();
}

void main();
