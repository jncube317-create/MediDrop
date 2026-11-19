// PostHog event tracking. Fire-and-forget: tracking never slows down or breaks the bot.
// Privacy: people are a scrambled ID (no phone numbers), and no message text, names or payment details are sent.

import { createHash } from "node:crypto";
import { env } from "./env";

export function anonId(phone: string): string {
  return createHash("sha256").update(`${env.ANALYTICS_SALT}:${phone}`).digest("hex").slice(0, 24);
}

type Props = Record<string, string | number | boolean | null>;

export function track(event: string, phone: string, props: Props = {}): void {
  if (!env.POSTHOG_KEY) return;
  const body = JSON.stringify({
    api_key: env.POSTHOG_KEY,
    event,
    distinct_id: anonId(phone),
    properties: { ...props, app: env.APP_NAME, $process_person_profile: false },
    timestamp: new Date().toISOString(),
  });
  void fetch(`${env.POSTHOG_HOST}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, body }).catch(() => {
    /* analytics must never break the bot */
  });
}
