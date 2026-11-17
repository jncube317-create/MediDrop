import { test } from "node:test";
import assert from "node:assert/strict";
import { MEDICINES, PHARMACIES, ZONES, findMedicines, isOpen, medicineImageUrl, offersFor } from "../src/data";

test("search finds brand names, generics and typos", () => {
  assert.equal(findMedicines("panado")[0]?.id, "m01");
  assert.equal(findMedicines("Paracetamol")[0]?.id, "m01");
  assert.equal(findMedicines("paracetmol")[0]?.id, "m01"); // typo
  assert.equal(findMedicines("amoxil")[0]?.id, "m13");
  assert.equal(findMedicines("xyzzy").length, 0);
  assert.ok(findMedicines("allergy").length >= 2);
});

test("offers are cheapest first and skip pharmacies without stock", () => {
  const med = MEDICINES.find((m) => m.id === "m01");
  assert.ok(med);
  const offers = offersFor(med, new Date(), true);
  const prices = offers.map((o) => o.priceCents);
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  const ibu = MEDICINES.find((m) => m.id === "m02");
  assert.ok(ibu);
  assert.ok(!offersFor(ibu, new Date(), true).some((o) => o.pharmacy.id === "p3"));
});

test("closed pharmacies are hidden", () => {
  const parklands = PHARMACIES.find((p) => p.id === "p4");
  assert.ok(parklands);
  // 14:00 Harare = 12:00 UTC: Parklands (08:00-13:00) is closed
  const afternoon = new Date("2026-11-17T12:00:00Z");
  assert.equal(isOpen(parklands, afternoon), false);
  // 10:00 Harare = 08:00 UTC: open
  assert.equal(isOpen(parklands, new Date("2026-11-17T08:00:00Z")), true);
  const med = MEDICINES.find((m) => m.id === "m01");
  assert.ok(med);
  assert.ok(!offersFor(med, afternoon, false).some((o) => o.pharmacy.id === "p4"));
});

test("seed data fits WhatsApp limits", () => {
  for (const m of MEDICINES) assert.ok(m.name.length <= 24, m.name);
  for (const p of PHARMACIES) assert.ok(p.name.length <= 24, p.name);
  for (const z of Object.values(ZONES)) {
    assert.ok(z.suburbs.length <= 10);
    for (const s of z.suburbs) assert.ok(s.length <= 24, s);
    for (const m of MEDICINES) for (const v of Object.values(m.prices)) assert.ok(Number.isInteger(v));
  }
});

test("demo searches that show picture cards return 2+ matches", () => {
  assert.ok(findMedicines("pain").length >= 2);
  assert.ok(findMedicines("allergy").length >= 2);
});

test("image links only when the server has a public https address", () => {
  assert.equal(medicineImageUrl("https://medidrop.up.railway.app", "m01"), "https://medidrop.up.railway.app/img/m01.jpg");
  assert.equal(medicineImageUrl("", "m01"), null);
});

test("every medicine has a sample picture file", async () => {
  const { existsSync } = await import("node:fs");
  for (const m of MEDICINES) assert.ok(existsSync(`public/img/${m.id}.jpg`), m.id);
});
