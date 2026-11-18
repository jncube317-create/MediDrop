// Paynow mobile (EcoCash / OneMoney) in test mode.
// If Paynow keys aren't set yet, payments are SIMULATED so the demo still runs.
// Credits are only added after the SERVER confirms it with Paynow.

import paynowPkg from "paynow";
import { env, paynowConfigured } from "./env";
import { centsToPaynowAmount } from "./money";
import { classifyStatus, type PaymentState } from "./paystatus";

export type PayMethod = "ecocash" | "onemoney";

const { Paynow } = paynowPkg as { Paynow: new (id: string, key: string, resultUrl: string, returnUrl: string) => PaynowClient };

interface PaynowPayment {
  add(title: string, amount: number): PaynowPayment;
}
interface PaynowInitResponse {
  success: boolean;
  status: string;
  error?: string;
  pollUrl?: string;
  instructions?: string;
}
interface PaynowClient {
  createPayment(reference: string, authEmail: string): PaynowPayment;
  sendMobile(payment: PaynowPayment, phone: string, method: string): Promise<PaynowInitResponse | null | undefined>;
  pollTransaction(url: string): Promise<PaynowInitResponse | null | undefined>;
}

export type StartResult =
  | { ok: true; pollUrl: string | null; simulated: boolean }
  | { ok: false; error: string };

function client(orderId: string): PaynowClient {
  const resultUrl = env.PUBLIC_URL ? `${env.PUBLIC_URL}/paynow/result?ref=${encodeURIComponent(orderId)}` : "https://example.com/result";
  const returnUrl = env.PUBLIC_URL || "https://example.com";
  return new Paynow(env.PAYNOW_INTEGRATION_ID, env.PAYNOW_INTEGRATION_KEY, resultUrl, returnUrl);
}

export async function startPayment(
  orderId: string,
  reference: string,
  description: string,
  totalCents: number,
  payerNumber: string, // local format 07XXXXXXXX
  method: PayMethod,
): Promise<StartResult> {
  if (!paynowConfigured) {
    console.warn(`[PAY] Paynow keys not set. SIMULATING payment for ${orderId}.`);
    return { ok: true, pollUrl: null, simulated: true };
  }
  try {
    const paynow = client(orderId);
    const payment = paynow.createPayment(reference, env.PAYNOW_AUTH_EMAIL);
    payment.add(description, centsToPaynowAmount(totalCents));
    // PAYNOW_PAY_PHONE is a testing override only. Leave it unset so the payer's own number is billed.
    const phone = env.PAYNOW_PAY_PHONE || payerNumber;
    const response = await paynow.sendMobile(payment, phone, method);
    if (!response) return { ok: false, error: "No response from Paynow" };
    if (!response.success || !response.pollUrl) {
      console.error(`[PAY] Paynow refused ${orderId}: ${response.error ?? response.status}`);
      return { ok: false, error: response.error ?? "Paynow refused the payment" };
    }
    return { ok: true, pollUrl: response.pollUrl, simulated: false };
  } catch (err) {
    console.error(`[PAY] start failed for ${orderId}:`, err instanceof Error ? err.message : err);
    return { ok: false, error: "Payment couldn't start" };
  }
}

export async function checkPayment(pollUrl: string | null, simulated: boolean, startedAt: number): Promise<PaymentState> {
  if (simulated) return Date.now() - startedAt > env.SIMULATED_PAY_SECONDS * 1000 ? "paid" : "pending";
  if (!pollUrl) return "failed";
  try {
    const response = await client("poll").pollTransaction(pollUrl);
    if (!response?.status) return "pending";
    return classifyStatus(response.status);
  } catch (err) {
    console.error("[PAY] poll failed:", err instanceof Error ? err.message : err);
    return "pending";
  }
}
