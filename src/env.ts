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
  // The store phone: gets new orders, packs them, checks pickup codes.
  STAFF_PHONE: digitsOnly(required("STAFF_PHONE")),
  STORE_NAME: optional("STORE_NAME") || "Greens",
  BRANCH_NAME: optional("BRANCH_NAME") || "Greens demo branch",
  PUBLIC_URL: optional("PUBLIC_URL") || (railwayDomain ? `https://${railwayDomain}` : ""),
  PAYNOW_INTEGRATION_ID: optional("PAYNOW_INTEGRATION_ID"),
  PAYNOW_INTEGRATION_KEY: optional("PAYNOW_INTEGRATION_KEY"),
  PAYNOW_AUTH_EMAIL: optional("PAYNOW_AUTH_EMAIL"),
  PAYNOW_PAY_PHONE: optional("PAYNOW_PAY_PHONE"),
  // OneMoney must also be enabled on the Paynow integration before turning this on.
  ONEMONEY_ENABLED: optional("ONEMONEY_ENABLED").toLowerCase() === "true",
  // Demo only: seconds before a simulated payment confirms.
  SIMULATED_PAY_SECONDS: Number(optional("SIMULATED_PAY_SECONDS") || "6"),
};

export const paynowConfigured = Boolean(
  env.PAYNOW_INTEGRATION_ID && env.PAYNOW_INTEGRATION_KEY && env.PAYNOW_AUTH_EMAIL,
);
