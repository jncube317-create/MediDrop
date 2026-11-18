// Pickup time slots. Pure functions, fully tested.
// Zimbabwe (Africa/Harare) is UTC+2 all year with no daylight saving,
// so Harare time = UTC + 2 hours.

const HARARE_OFFSET_MS = 2 * 60 * 60 * 1000;

export interface SlotRules {
  opensHour: number; // first slot starts here, e.g. 8 → 08:00
  closesHour: number; // last slot ends here, e.g. 20 → 20:00
  prepMinutes: number; // packing time needed before a slot starts
  capacity: number; // orders per slot
}

export const DEFAULT_SLOT_RULES: SlotRules = { opensHour: 8, closesHour: 20, prepMinutes: 60, capacity: 10 };

export interface Slot {
  id: string; // "2026-11-18T16" (Harare date + start hour)
  label: string; // "Today 16:00–17:00"
  startsAt: number; // ms since epoch
  endsAt: number;
  spotsLeft: number;
}

function harareParts(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const t = new Date(ms + HARARE_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), h: t.getUTCHours(), min: t.getUTCMinutes() };
}

/** Epoch ms for a Harare wall-clock date + hour. */
function harareTime(y: number, m: number, d: number, h: number): number {
  return Date.UTC(y, m, d, h) - HARARE_OFFSET_MS;
}

const pad = (n: number) => n.toString().padStart(2, "0");

export function slotId(startsAt: number): string {
  const p = harareParts(startsAt);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)}T${pad(p.h)}`;
}

export function slotLabel(startsAt: number, now: number): string {
  const s = harareParts(startsAt);
  const n = harareParts(now);
  const dayDiff = Math.round((Date.UTC(s.y, s.m, s.d) - Date.UTC(n.y, n.m, n.d)) / 86_400_000);
  const day =
    dayDiff === 0
      ? "Today"
      : dayDiff === 1
        ? "Tomorrow"
        : new Date(Date.UTC(s.y, s.m, s.d)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return `${day} ${pad(s.h)}:00–${pad(s.h + 1)}:00`;
}

/**
 * The next pickup slots that still have room, soonest first.
 * A slot is offered only if it starts at least prepMinutes from now.
 * booked: how many orders are already in each slot id.
 */
export function availableSlots(now: number, booked: Map<string, number>, rules = DEFAULT_SLOT_RULES, max = 8): Slot[] {
  const slots: Slot[] = [];
  const today = harareParts(now);
  for (let dayOffset = 0; dayOffset < 3 && slots.length < max; dayOffset++) {
    for (let h = rules.opensHour; h < rules.closesHour && slots.length < max; h++) {
      const startsAt = harareTime(today.y, today.m, today.d + dayOffset, h);
      if (startsAt - now < rules.prepMinutes * 60_000) continue;
      const id = slotId(startsAt);
      const spotsLeft = rules.capacity - (booked.get(id) ?? 0);
      if (spotsLeft <= 0) continue;
      slots.push({ id, label: slotLabel(startsAt, now), startsAt, endsAt: startsAt + 3_600_000, spotsLeft });
    }
  }
  return slots;
}
