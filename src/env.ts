// Reads settings from environment variables (Railway → Variables).
// Secrets live only here, never in code.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}. Add it in Railway → Variables.`);
  return value;
}

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/** WhatsApp sends numbers as digits only, e.g. 263771234567. */
export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

const railwayDomain = optional("RAILWAY_PUBLIC_DOMAIN");

export const env = {
  PORT: Number(optional("PORT") || "3000"),
  WA_TOKEN: required("WA_TOKEN"),
  WA_PHONE_NUMBER_ID: required("WA_PHONE_NUMBER_ID"),
  WA_VERIFY_TOKEN: required("WA_VERIFY_TOKEN"),
  WA_APP_SECRET: optional("WA_APP_SECRET"),
  GRAPH_API_VERSION: optional("GRAPH_API_VERSION") || "v23.0",
  GRAPH_BASE_URL: optional("GRAPH_BASE_URL") || "https://graph.facebook.com", // only changed for local testing
  APP_NAME: optional("APP_NAME") || "Scoutly",
  // Optional: gets reports and can type STATS. Can also use the bot normally.
  // Falls back to the Greens STAFF_PHONE so the Greens Railway service works unchanged.
  ADMIN_PHONE: digitsOnly(optional("ADMIN_PHONE") || optional("STAFF_PHONE")),
  PUBLIC_URL: optional("PUBLIC_URL") || (railwayDomain ? `https://${railwayDomain}` : ""),
  // Sample listings, providers and ads so a one-phone demo works. Set false for real use.
  SAMPLE_PROVIDERS: optional("SAMPLE_PROVIDERS").toLowerCase() !== "false",
  SAMPLE_REPLY_SECONDS: Number(optional("SAMPLE_REPLY_SECONDS") || "8"),
  PAYNOW_INTEGRATION_ID: optional("PAYNOW_INTEGRATION_ID"),
  PAYNOW_INTEGRATION_KEY: optional("PAYNOW_INTEGRATION_KEY"),
  PAYNOW_AUTH_EMAIL: optional("PAYNOW_AUTH_EMAIL"),
  PAYNOW_PAY_PHONE: optional("PAYNOW_PAY_PHONE"),
  // Optional PostHog analytics (EU cloud by default). No key = no tracking.
  POSTHOG_KEY: optional("POSTHOG_KEY"),
  POSTHOG_HOST: optional("POSTHOG_HOST") || "https://eu.i.posthog.com",
  ANALYTICS_SALT: optional("ANALYTICS_SALT") || "scoutly",
  MEDIA_DIR: optional("MEDIA_DIR") || "/tmp/scoutly-media",
  // Demo only: seconds before a simulated payment confirms.
  SIMULATED_PAY_SECONDS: Number(optional("SIMULATED_PAY_SECONDS") || "6"),
};

export const paynowConfigured = Boolean(
  env.PAYNOW_INTEGRATION_ID && env.PAYNOW_INTEGRATION_KEY && env.PAYNOW_AUTH_EMAIL,
);
