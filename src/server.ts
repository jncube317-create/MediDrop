import Fastify from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env, paynowConfigured } from "./env";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { handleIncoming, confirmPurchase, type Incoming } from "./bot";
import { MEDIA_DIR, SAFE_FILE } from "./media";

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
  image?: { id?: string };
}

function toIncoming(msg: WaMessage): Incoming {
  if (msg.type === "text" && msg.text?.body) return { from: msg.from, kind: "text", text: msg.text.body };
  const replyId = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
  if (msg.type === "interactive" && replyId) return { from: msg.from, kind: "reply", id: replyId };
  if (msg.type === "button" && msg.button?.payload) return { from: msg.from, kind: "reply", id: msg.button.payload };
  if (msg.type === "image" && msg.image?.id) return { from: msg.from, kind: "image", mediaId: msg.image.id };
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

app.get("/", async () => ({ app: `${env.APP_NAME} demo`, status: "running" }));

// Demo listing photos (public/demo) and photos people send the bot (MEDIA_DIR).
const DEMO_DIR = join(process.cwd(), "public", "demo");
app.get("/img/:file", async (req, reply) => {
  const file = (req.params as { file: string }).file;
  if (!/^[a-z0-9-]+\.jpg$/.test(file)) return reply.code(404).send();
  try {
    return reply.type("image/jpeg").header("Cache-Control", "public, max-age=86400").send(await readFile(join(DEMO_DIR, file)));
  } catch {
    return reply.code(404).send();
  }
});
app.get("/media/:file", async (req, reply) => {
  const file = (req.params as { file: string }).file;
  if (!SAFE_FILE.test(file)) return reply.code(404).send();
  try {
    return reply.type("image/jpeg").header("Cache-Control", "public, max-age=86400").send(await readFile(join(MEDIA_DIR, file)));
  } catch {
    return reply.code(404).send();
  }
});
app.get("/health", async () => ({ ok: true, app: env.APP_NAME, paynow: paynowConfigured ? "test mode" : "simulated" }));

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
  const ref = (req.query as Record<string, string | undefined>).ref;
  if (ref) await confirmPurchase(ref);
  return reply.code(200).send("OK");
});

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then(() => {
    console.log(`${env.APP_NAME} demo running on port ${env.PORT}`);
    console.log(`Payments: ${paynowConfigured ? "Paynow TEST MODE" : "SIMULATED (Paynow keys not set)"}`);
    if (!env.WA_APP_SECRET) console.warn("⚠️ WA_APP_SECRET not set: webhook signatures are NOT being checked. Add it before go-live.");
    if (!env.PUBLIC_URL) console.warn("⚠️ No public URL yet: generate a domain in Railway → Settings → Networking (needed for Paynow).");
    console.log(`Sample listings and ads: ${env.SAMPLE_PROVIDERS ? "ON (demo)" : "OFF"}`);
    console.log(`Analytics: ${env.POSTHOG_KEY ? `PostHog (${env.POSTHOG_HOST})` : "off (no POSTHOG_KEY)"}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
