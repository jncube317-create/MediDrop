import { test } from "node:test";
import assert from "node:assert/strict";
import { availableSlots, slotId, slotLabel } from "../src/slots";

// 14:20 Harare = 12:20 UTC on Wed 18 Nov 2026
const NOW = Date.parse("2026-11-18T12:20:00Z");

test("first slot leaves at least an hour to pack", () => {
  const slots = availableSlots(NOW, new Map());
  assert.equal(slots[0]?.id, "2026-11-18T16"); // 15:00 is only 40 min away
  assert.equal(slots[0]?.label, "Today 16:00–17:00");
});

test("slots run until closing, then continue tomorrow morning", () => {
  const slots = availableSlots(NOW, new Map());
  const ids = slots.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 5), ["2026-11-18T16", "2026-11-18T17", "2026-11-18T18", "2026-11-18T19", "2026-11-19T08"]);
  assert.equal(slots[4]?.label, "Tomorrow 08:00–09:00");
  assert.equal(slots.length, 8);
});

test("late at night, slots start tomorrow", () => {
  const night = Date.parse("2026-11-18T21:30:00Z"); // 23:30 Harare
  const slots = availableSlots(night, new Map());
  assert.equal(slots[0]?.label, "Tomorrow 08:00–09:00");
});

test("full slots are skipped and spots left are shown", () => {
  const booked = new Map([
    ["2026-11-18T16", 10],
    ["2026-11-18T17", 7],
  ]);
  const slots = availableSlots(NOW, booked);
  assert.equal(slots[0]?.id, "2026-11-18T17");
  assert.equal(slots[0]?.spotsLeft, 3);
});

test("slot ids and labels use Harare time", () => {
  const start = Date.parse("2026-11-18T14:00:00Z"); // 16:00 Harare
  assert.equal(slotId(start), "2026-11-18T16");
  assert.equal(slotLabel(start, NOW), "Today 16:00–17:00");
  assert.match(slotLabel(start + 2 * 86_400_000, NOW), /^Fri 20 Nov 16:00–17:00$/);
});

test("slot labels fit a WhatsApp list row title (24 chars)", () => {
  for (const s of availableSlots(NOW, new Map(), undefined, 30)) assert.ok(s.label.length <= 24, s.label);
});
