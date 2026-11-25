// WhatsApp Cloud API send helpers. Every failure is logged with Meta's error,
// so a silent "no reply" never happens again.

import { env } from "./env";
import { validateButtons, validateCarousel, validateList, validateText, type Button, type CarouselCard, type ListRow } from "./limits";

const graph = () => `${env.GRAPH_BASE_URL}/${env.GRAPH_API_VERSION}`;
const authHeader = () => ({ Authorization: `Bearer ${env.WA_TOKEN}` });

/**
 * Hooks the bot sets: `hold` takes a free-form message the person can't receive right now
 * (more than 24 hours since they last wrote) so it can be delivered later; `sent` counts messages.
 */
export interface SendHooks {
  hold: (to: string, payload: Record<string, unknown>) => boolean;
  sent: (to: string, payload: Record<string, unknown>) => void;
}
let hooks: SendHooks | null = null;
export function setSendHooks(h: SendHooks): void {
  hooks = h;
}

/** Recent message IDs → what was sent, so a late "outside the 24-hour window" failure can still be held. */
const recent = new Map<string, { to: string; payload: Record<string, unknown> }>();
export function sentMessage(wamid: string): { to: string; payload: Record<string, unknown> } | null {
  return recent.get(wamid) ?? null;
}

async function postMessage(payload: Record<string, unknown>, direct = false): Promise<boolean> {
  if (!direct && payload.type !== "template" && hooks?.hold(String(payload.to), payload)) return true;
  try {
    const res = await fetch(`${graph()}/${env.WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { ...authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[WA] SEND FAILED (HTTP ${res.status}) to ...${String(payload.to).slice(-4)}: ${errorBody}`);
      return false;
    }
    try {
      const out = (await res.json()) as { messages?: { id?: string }[] };
      const wamid = out.messages?.[0]?.id;
      if (wamid) {
        recent.set(wamid, { to: String(payload.to), payload });
        if (recent.size > 3000) recent.delete(recent.keys().next().value as string);
      }
    } catch {
      /* no body: fine */
    }
    hooks?.sent(String(payload.to), payload);
    return true;
  } catch (err) {
    console.error("[WA] SEND FAILED (network):", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function sendText(to: string, body: string): Promise<boolean> {
  const problem = validateText(body);
  if (problem) {
    console.error(`[WA] refused to send text: ${problem}`);
    return false;
  }
  return postMessage({ to, type: "text", text: { body, preview_url: false } });
}

export interface ButtonExtras {
  imageUrl?: string; // public https picture shown above the text
  footer?: string; // small grey line under the text, max 60 chars
}

export async function sendButtons(to: string, body: string, buttons: Button[], extras: ButtonExtras = {}): Promise<boolean> {
  const problem = validateButtons(body, buttons) ?? (extras.footer && extras.footer.length > 60 ? "footer over 60 chars" : null);
  if (problem) {
    console.error(`[WA] refused to send buttons: ${problem}`);
    return false;
  }
  return postMessage({
    to,
    type: "interactive",
    interactive: {
      type: "button",
      ...(extras.imageUrl ? { header: { type: "image", image: { link: extras.imageUrl } } } : {}),
      body: { text: body },
      ...(extras.footer ? { footer: { text: extras.footer } } : {}),
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    },
  });
}

export async function sendList(
  to: string,
  body: string,
  buttonText: string,
  rows: ListRow[],
  sectionTitle = "Options",
): Promise<boolean> {
  const problem = validateList(body, buttonText, sectionTitle, rows);
  if (problem) {
    console.error(`[WA] refused to send list: ${problem}`);
    return false;
  }
  return postMessage({
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: body },
      action: {
        button: buttonText,
        sections: [
          {
            title: sectionTitle,
            rows: rows.map((r) => (r.description ? { id: r.id, title: r.title, description: r.description } : { id: r.id, title: r.title })),
          },
        ],
      },
    },
  });
}

export async function sendImage(to: string, mediaId: string, caption: string): Promise<boolean> {
  return postMessage({ to, type: "image", image: { id: mediaId, caption } });
}

export async function sendImageLink(to: string, link: string, caption: string): Promise<boolean> {
  return postMessage({ to, type: "image", image: { link, caption } });
}

/** Swipeable picture cards (2-10), each with quick-reply buttons. Returns false if refused or rejected. */
export async function sendCarousel(to: string, body: string, cards: CarouselCard[]): Promise<boolean> {
  const problem = validateCarousel(body, cards);
  if (problem) {
    console.error(`[WA] refused to send carousel: ${problem}`);
    return false;
  }
  return postMessage({
    to,
    type: "interactive",
    interactive: {
      type: "carousel",
      body: { text: body },
      action: {
        cards: cards.map((c, i) => ({
          card_index: i,
          type: "cta_url", // Meta's carousel examples set this on every card, quick-reply cards included
          header: { type: "image", image: { link: c.imageUrl } },
          body: { text: c.text },
          action: {
            buttons: c.buttons.map((b) => ({ type: "quick_reply", quick_reply: { id: b.id, title: b.title } })),
          },
        })),
      },
    },
  });
}

/** Re-sends a message exactly as it was first built (used to deliver held messages). */
export async function resend(payload: Record<string, unknown>): Promise<boolean> {
  return postMessage(payload, true);
}

/**
 * The approved "you have an update waiting" template: the only kind of message WhatsApp
 * allows more than 24 hours after someone last wrote. Its button brings them back.
 */
export async function sendUpdateTemplate(to: string, name: string): Promise<boolean> {
  return postMessage({
    to,
    type: "template",
    template: {
      name: env.WA_UPDATE_TEMPLATE,
      language: { code: env.WA_TEMPLATE_LANG },
      components: [
        { type: "body", parameters: [{ type: "text", text: name }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "held:show" }] },
      ],
    },
  });
}
