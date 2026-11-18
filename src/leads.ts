// A lead = one need sent to one provider. Only these moves are allowed.
//
// OFFERED ──Interested──► INTERESTED ──customer accepts──► CONNECTED
//    │                         │
//    ├─Not for me─► PASSED     └─customer says no─► DECLINED
//    └────────── 48h ──► EXPIRED ◄── 48h / need closed ──┘

export type LeadStatus = "OFFERED" | "INTERESTED" | "CONNECTED" | "PASSED" | "DECLINED" | "EXPIRED";

export interface Lead {
  id: string;
  needId: string;
  offerId: string;
  provider: string; // phone
  customer: string; // phone
  status: LeadStatus;
  createdAt: number;
  updatedAt: number;
  rated: boolean;
  reported: boolean;
}

const ALLOWED: Record<LeadStatus, LeadStatus[]> = {
  OFFERED: ["INTERESTED", "PASSED", "EXPIRED"],
  INTERESTED: ["CONNECTED", "DECLINED", "EXPIRED"],
  CONNECTED: [],
  PASSED: [],
  DECLINED: [],
  EXPIRED: [],
};

export const LEAD_TTL_MS = 48 * 60 * 60 * 1000;

export function canMove(from: LeadStatus, to: LeadStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Moves a lead if allowed. Returns false (and changes nothing) otherwise. */
export function moveLead(lead: Lead, to: LeadStatus, now = Date.now()): boolean {
  if (!canMove(lead.status, to)) return false;
  console.log(`[LEAD] ${lead.id} ${lead.status} → ${to}`);
  lead.status = to;
  lead.updatedAt = now;
  return true;
}

export function isOpen(lead: Lead): boolean {
  return lead.status === "OFFERED" || lead.status === "INTERESTED";
}

export function isStale(lead: Lead, now = Date.now()): boolean {
  return isOpen(lead) && now - lead.updatedAt > LEAD_TTL_MS;
}

/** "263771234567" → "+263 77 123 4567". */
export function prettyPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.startsWith("263") && d.length === 12) return `+263 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  return `+${d}`;
}

export function chatLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}
