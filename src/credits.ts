// Credit ledger. Append-only: the balance is always the sum of the entries.
// Every entry has a unique key, so repeating the same action never double-counts.
//
// Swapping numbers costs credits on both sides. While waiting for the other side we HOLD
// the credits. If the swap happens the hold is CAPTURED (spent); if not it's RELEASED (given back).

export type EntryKind = "welcome" | "purchase" | "hold" | "release" | "capture" | "grant" | "spend" | "expire";

// Free vs bought credits: welcome and weekly credits are FREE and never carry over to the next
// week; purchases and admin grants are BOUGHT and never expire. Free credits are used first.
const isFree = (e: Entry) => e.kind === "welcome" || e.kind === "expire" || (e.kind === "grant" && e.key.startsWith("weekly:"));


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

  /** Every entry, oldest first (for saving). */
  all(): readonly Entry[] {
    return this.entries;
  }

  /** Restores saved entries after a restart. Duplicate keys are skipped. */
  load(saved: Entry[]): void {
    for (const e of saved) {
      if (this.keys.has(e.key)) continue;
      this.keys.add(e.key);
      this.entries.push({ ...e });
    }
  }

  balance(phone: string): number {
    return this.entries.filter((e) => e.phone === phone).reduce((sum, e) => sum + e.delta, 0);
  }

  /**
   * Free credits still unused. Walks the history in order: free credits are used before bought
   * ones, and a released hold goes back to the pool it came from.
   */
  freeLeft(phone: string): number {
    let free = 0;
    let bought = 0;
    const fromFree = new Map<string, number>(); // hold key → how much of it was free credits
    for (const e of this.entries) {
      if (e.phone !== phone) continue;
      if (isFree(e)) free += e.delta;
      else if (e.kind === "purchase" || e.kind === "grant") bought += e.delta;
      else if (e.kind === "hold" || e.kind === "spend") {
        const take = -e.delta;
        const f = Math.min(Math.max(free, 0), take);
        free -= f;
        bought -= take - f;
        fromFree.set(e.key.replace(/^hold:/, ""), f);
      } else if (e.kind === "release") {
        const f = Math.min(fromFree.get(e.key.replace(/^release:/, "")) ?? 0, e.delta);
        free += f;
        bought += e.delta - f;
      }
    }
    return Math.max(0, free);
  }

  /** Bought credits still unused. */
  boughtLeft(phone: string): number {
    return this.balance(phone) - this.freeLeft(phone);
  }

  /**
   * New week: unused free credits from last week disappear, then this week's free credits are
   * added, so free credits are always exactly `amount` at the start of a week. Bought credits
   * are untouched. Safe to call often (once per week key). Returns credits added.
   */
  weeklyReset(phone: string, amount: number, week: string): number {
    if (amount <= 0 || this.keys.has(`weekly:${phone}:${week}`)) return 0;
    const unused = this.freeLeft(phone);
    if (unused > 0) this.add(phone, -unused, "expire", `expire:${phone}:${week}`);
    this.add(phone, amount, "grant", `weekly:${phone}:${week}`);
    return amount;
  }

  /** Free credits can never be more than `cap` (fixes anyone who got two lots in one week). */
  capFree(phone: string, cap: number, week: string): number {
    const extra = this.freeLeft(phone) - cap;
    if (extra <= 0) return 0;
    return this.add(phone, -extra, "expire", `cap:${phone}:${week}`) ? extra : 0;
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
    if (credits <= 0) throw new Error("grant must add credits");
    return this.add(phone, credits, "grant", `grant:${key}`);
  }

  /** Weekly free credits: adds `amount` once per week (the week key makes it safe to call often). Returns credits added. */
  weekly(phone: string, amount: number, week: string): number {
    if (amount <= 0) return 0;
    return this.add(phone, amount, "grant", `weekly:${phone}:${week}`) ? amount : 0;
  }

  /** Straight spend (e.g. a sponsored-ad tap). False if the balance is too low or already spent. */
  spend(phone: string, amount: number, key: string): boolean {
    if (amount <= 0) throw new Error("spend must be positive");
    if (this.keys.has(`spend:${key}`) || this.balance(phone) < amount) return false;
    return this.add(phone, -amount, "spend", `spend:${key}`);
  }

  hasSpent(key: string): boolean {
    return this.keys.has(`spend:${key}`);
  }

  isHeld(key: string): boolean {
    return this.keys.has(`hold:${key}`) && !this.keys.has(`release:${key}`) && !this.keys.has(`capture:${key}`);
  }

  /** Reserves credits. False if the balance is too low or this key was already held. */
  hold(phone: string, key: string, amount = 1): boolean {
    if (amount <= 0) throw new Error("hold must be positive");
    if (this.keys.has(`hold:${key}`)) return false;
    if (this.balance(phone) < amount) return false;
    return this.add(phone, -amount, "hold", `hold:${key}`);
  }

  /** The swap happened: the held credits are spent. */
  capture(key: string): boolean {
    const hold = this.entries.find((e) => e.key === `hold:${key}`);
    if (!hold || !this.isHeld(key)) return false;
    return this.add(hold.phone, 0, "capture", `capture:${key}`);
  }

  /** Declined, expired or closed: the held credits come back. */
  release(key: string): boolean {
    const hold = this.entries.find((e) => e.key === `hold:${key}`);
    if (!hold || !this.isHeld(key)) return false;
    return this.add(hold.phone, -hold.delta, "release", `release:${key}`);
  }
}
