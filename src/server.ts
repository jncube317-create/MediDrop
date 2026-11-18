import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env, paynowConfigured } from "./env";
import { handleIncoming, confirmPayment, findOrderByQrToken, type Incoming } from "./bot";
import { qrPng } from "./qr";

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });

// Keep the raw body so we can check Meta's signature.
app.removeContentTypeParser(["application/json"]);
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  try {
    done(null, (body as string).length ? JSON.parse(body as string) : {});
  } catch {
    done(null, {});
  }
});
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(body as string)));
});

function signatureValid(rawBody: string, header: string | undefined): boolean {
  if (!env.WA_APP_SECRET) return true; // warned at startup
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.WA_APP_SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Meta retries webhooks, so ignore message IDs we've already seen.
const seen = new Map<string, number>();
function alreadySeen(id: string): boolean {
  if (seen.has(id)) return true;
  seen.set(id, Date.now());
  if (seen.size > 5000) {
    const oldest = seen.keys().next().value;
    if (oldest) seen.delete(oldest);
  }
  return false;
}

interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body?: string };
  interactive?: { button_reply?: { id: string }; list_reply?: { id: string } };
  button?: { payload?: string };
}

function toIncoming(msg: WaMessage): Incoming {
  if (msg.type === "text" && msg.text?.body) return { from: msg.from, kind: "text", text: msg.text.body };
  const replyId = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
  if (msg.type === "interactive" && replyId) return { from: msg.from, kind: "reply", id: replyId };
  if (msg.type === "button" && msg.button?.payload) return { from: msg.from, kind: "reply", id: msg.button.payload };
  return { from: msg.from, kind: "other" };
}

async function processWebhook(body: unknown): Promise<void> {
  const entries = (body as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] }).entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const statuses = (value.statuses as { status: string; recipient_id: string; errors?: unknown }[] | undefined) ?? [];
      for (const st of statuses) {
        if (st.status === "failed") {
          console.error(`[WA] DELIVERY FAILED to ...${st.recipient_id.slice(-4)}: ${JSON.stringify(st.errors)}`);
        }
      }
      const messages = (value.messages as WaMessage[] | undefined) ?? [];
      for (const msg of messages) {
        if (alreadySeen(msg.id)) continue;
        // Log the type only. Never message text.
        console.log(`[IN] ${msg.type} from ...${msg.from.slice(-4)}`);
        try {
          await handleIncoming(toIncoming(msg));
        } catch (err) {
          console.error("[BOT] error handling message:", err instanceof Error ? err.stack : err);
        }
      }
    }
  }
}

app.get("/", async () => ({ app: "Greens demo", status: "running" }));
// Sample product pictures for WhatsApp cards. Only files named like g01.jpg are served.
app.get("/img/:file", async (req, reply) => {
  const file = (req.params as { file: string }).file;
  if (!/^g\d{2}\.jpg$/.test(file)) return reply.code(404).send();
  try {
    const data = await readFile(join(process.cwd(), "public", "img", file));
    return reply.type("image/jpeg").header("Cache-Control", "public, max-age=3600").send(data);
  } catch {
    return reply.code(404).send();
  }
});
// Receipt QR. The token is random and only works while the order is waiting for pickup.
app.get("/qr/:file", async (req, reply) => {
  const match = /^([a-f0-9]{32})\.png$/.exec((req.params as { file: string }).file);
  const order = match?.[1] ? findOrderByQrToken(match[1]) : undefined;
  if (!order) return reply.code(404).send();
  const png = await qrPng(order.id, order.pickupCode);
  return reply.type("image/png").header("Cache-Control", "no-store").send(png);
});
app.get("/health", async () => ({ ok: true, paynow: paynowConfigured ? "test mode" : "simulated" }));

// Meta calls this once when you click "Verify and save".
app.get("/webhook", async (req, reply) => {
  const q = req.query as Record<string, string | undefined>;
  if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.WA_VERIFY_TOKEN) {
    console.log("[WA] webhook verified ✅");
    return reply.type("text/plain").send(q["hub.challenge"] ?? "");
  }
  console.error("[WA] webhook verify FAILED: the verify token in Meta doesn't match WA_VERIFY_TOKEN");
  return reply.code(403).send("Forbidden");
});

app.post("/webhook", async (req, reply) => {
  const raw = (req as unknown as { rawBody?: string }).rawBody ?? "";
  if (!signatureValid(raw, req.headers["x-hub-signature-256"] as string | undefined)) {
    console.error("[WA] bad signature: check WA_APP_SECRET matches Meta App settings → Basic → App secret");
    return reply.code(401).send();
  }
  void reply.code(200).send(); // answer Meta immediately, then work
  setImmediate(() => void processWebhook(req.body));
});

// Paynow calls this when a payment changes. We don't trust the body:
// we ask Paynow directly (poll) before marking anything paid.
app.post("/paynow/result", async (req, reply) => {
  const orderId = (req.query as Record<string, string | undefined>).order;
  if (orderId) await confirmPayment(orderId);
  return reply.code(200).send("OK");
});

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`Greens demo running on port ${env.PORT}`);
    console.log(`Payments: ${paynowConfigured ? "Paynow TEST MODE" : "SIMULATED (Paynow keys not set)"}`);
    if (!env.WA_APP_SECRET) console.warn("⚠️ WA_APP_SECRET not set: webhook signatures are NOT being checked. Add it before go-live.");
    if (!env.PUBLIC_URL) console.warn("⚠️ No public URL yet: generate a domain in Railway → Settings → Networking.");
    else console.log(`Pictures served from ${env.PUBLIC_URL}/img/g01.jpg`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
