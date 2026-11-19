// One-time number setup, run at startup when the variables are present.
// WA_REGISTER_PIN: registers the phone number with Cloud API (two-step PIN, 6 digits).
// WA_WABA_ID: subscribes this app to the WhatsApp Business account so messages reach the webhook.
// Both calls are safe to repeat. Remove WA_REGISTER_PIN from Railway once the logs say it worked.
import { env } from "./env.js";

async function post(path: string, body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${env.GRAPH_BASE_URL}/${env.GRAPH_API_VERSION}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return `${res.ok ? "OK" : `FAILED (HTTP ${res.status})`} ${text.slice(0, 300)}`;
}

export async function runNumberSetup(): Promise<void> {
  const pin = process.env.WA_REGISTER_PIN?.trim() ?? "";
  const wabaId = process.env.WA_WABA_ID?.trim() ?? "";
  if (pin) {
    if (!/^\d{6}$/.test(pin)) console.warn("[SETUP] WA_REGISTER_PIN must be exactly 6 digits; skipped.");
    else console.log(`[SETUP] Register number: ${await post(`${env.WA_PHONE_NUMBER_ID}/register`, { messaging_product: "whatsapp", pin })}`);
  }
  if (wabaId) console.log(`[SETUP] Subscribe app to WABA: ${await post(`${wabaId}/subscribed_apps`, {})}`);
}
