// Credit ledger. Append-only: the balance is always the sum of the entries.
// Every entry has a unique key, so repeating the same action never double-counts.
//
// 1 credit = 1 contact shared. When a provider says "Interested" we HOLD a credit.
// If the customer accepts, the hold is CAPTURED (spent). If not, it's RELEASED (given back).

export type EntryKind = "welcome" | "purchase" | "hold" | "release" | "capture" | "grant";

export interface Entry {
  phone: string;
  delta: number;
  kind: EntryKind;
  key: string;
  at: number;
}

export class Ledger {
  private entries: Entry[] = [];
  private keys = new Set<string>();

  private add(phone: string, delta: number, kind: EntryKind, key: string): boolean {
    if (!Number.isInteger(delta)) throw new Error(`credit delta must be a whole number, got ${delta}`);
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    this.entries.push({ phone, delta, kind, key, at: Date.now() });
    return true;
  }

  balance(phone: string): number {
    return this.entries.filter((e) => e.phone === phone).reduce((sum, e) => sum + e.delta, 0);
  }

  history(phone: string): Entry[] {
    return this.entries.filter((e) => e.phone === phone);
  }

  /** Free starter credits, once per phone number ever. */
  welcome(phone: string, credits: number): boolean {
    return this.add(phone, credits, "welcome", `welcome:${phone}`);
  }

  /** Paid credits. The payment reference makes it safe if Paynow confirms twice. */
  purchase(phone: string, credits: number, paymentRef: string): boolean {
    if (credits <= 0) throw new Error("purchase must add credits");
    return this.add(phone, credits, "purchase", `purchase:${paymentRef}`);
  }

  /** Admin or demo top-up. */
  grant(phone: string, credits: number, key: string): boolean {
    return this.add(phone, credits, "grant", `grant:${key}`);
  }

  isHeld(leadId: string): boolean {
    return this.keys.has(`hold:${leadId}`) && !this.keys.has(`release:${leadId}`) && !this.keys.has(`capture:${leadId}`);
  }

  /** Reserves 1 credit for a lead. False if the balance is too low (or it's already held). */
  hold(phone: string, leadId: string): boolean {
    if (this.keys.has(`hold:${leadId}`)) return false;
    if (this.balance(phone) < 1) return false;
    return this.add(phone, -1, "hold", `hold:${leadId}`);
  }

  /** The customer accepted: the held credit is spent. */
  capture(leadId: string): boolean {
    const hold = this.entries.find((e) => e.key === `hold:${leadId}`);
    if (!hold || !this.isHeld(leadId)) return false;
    return this.add(hold.phone, 0, "capture", `capture:${leadId}`);
  }

  /** The customer declined or the lead expired: the credit goes back. */
  release(leadId: string): boolean {
    const hold = this.entries.find((e) => e.key === `hold:${leadId}`);
    if (!hold || !this.isHeld(leadId)) return false;
    return this.add(hold.phone, 1, "release", `release:${leadId}`);
  }
}
