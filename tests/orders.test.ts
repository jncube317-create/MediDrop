import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, checkPickupCode, markMissing, newPickupCode, transition, type Order } from "../src/orders";
import { classifyStatus, networkMatches, normalizeZwMobile, toLocalNumber } from "../src/paystatus";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "GR-1",
    customer: "263771234567",
    customerName: "Thandi",
    lines: [
      { productId: "g04", name: "Mazoe Orange Crush 2L", qty: 2, unitCents: 420, missing: false },
      { productId: "g01", name: "Proton White Loaf", qty: 1, unitCents: 110, missing: false },
    ],
    slot: { id: "2026-11-18T16", label: "Today 16:00–17:00", startsAt: 0, endsAt: 0 },
    totalCents: 950,
    walletCents: 0,
    payCents: 950,
    refundedCents: 0,
    status: "DRAFT",
    pickupCode: "483920",
    qrToken: "a".repeat(32),
    arrived: false,
    payment: null,
    paymentAttempts: 0,
    events: [],
    createdAt: 0,
    collectedAt: null,
    ...overrides,
  };
}

test("happy path: pay → packed → collected, every move logged", () => {
  const o = makeOrder();
  assert.equal(transition(o, "AWAITING_PAYMENT", "customer"), true);
  assert.equal(transition(o, "PAID", "paynow"), true);
  assert.equal(transition(o, "READY", "staff"), true);
  assert.equal(transition(o, "COLLECTED", "staff"), true);
  assert.equal(o.events.length, 4);
  assert.deepEqual([o.events[1]?.from, o.events[1]?.to], ["AWAITING_PAYMENT", "PAID"]);
});

test("refused moves change nothing", () => {
  const o = makeOrder();
  assert.equal(transition(o, "PAID", "x"), false); // can't skip payment
  assert.equal(o.status, "DRAFT");
  assert.equal(o.events.length, 0);
  assert.equal(canTransition("PAID", "COLLECTED"), false); // must be packed first
  assert.equal(canTransition("PAID", "CANCELLED"), false); // paid orders aren't cancelled, they become issues
  assert.equal(canTransition("COLLECTED", "READY"), false);
});

test("payment confirmation is idempotent", () => {
  const o = makeOrder({ status: "AWAITING_PAYMENT" });
  assert.equal(transition(o, "PAID", "paynow"), true);
  assert.equal(transition(o, "PAID", "paynow"), false);
  assert.equal(o.events.length, 1);
});

test("missing item refunds that line's full value", () => {
  const o = makeOrder({ status: "PAID" });
  assert.deepEqual(markMissing(o, "g04"), { ok: true, refundCents: 840, allMissing: false });
  assert.equal(o.refundedCents, 840);
  assert.deepEqual(markMissing(o, "g04"), { ok: false, reason: "already_missing" }); // no double refund
  assert.deepEqual(markMissing(o, "g01"), { ok: true, refundCents: 110, allMissing: true });
  assert.equal(o.refundedCents, 950);
});

test("items can only be marked missing while packing", () => {
  assert.deepEqual(markMissing(makeOrder({ status: "READY" }), "g04"), { ok: false, reason: "not_packing" });
  assert.deepEqual(markMissing(makeOrder({ status: "PAID" }), "g99"), { ok: false, reason: "not_in_order" });
});

test("pickup code: valid only when packed, and only once", () => {
  const o = makeOrder({ status: "PAID" });
  assert.equal(checkPickupCode([o], "483920").result, "still_packing");
  o.status = "READY";
  assert.equal(checkPickupCode([o], "483 920").result, "ok"); // spaces are fine
  o.status = "COLLECTED";
  assert.equal(checkPickupCode([o], "483920").result, "already_collected");
  assert.equal(checkPickupCode([o], "000000").result, "not_found");
  assert.equal(checkPickupCode([o], "4839").result, "not_found");
});

test("an old collected order with a reused code doesn't block a new one", () => {
  const old = makeOrder({ id: "GR-1", status: "COLLECTED" });
  const fresh = makeOrder({ id: "GR-2", status: "READY" });
  const check = checkPickupCode([old, fresh], "483920");
  assert.equal(check.result, "ok");
  assert.equal(check.result === "ok" && check.order.id, "GR-2");
});

test("pickup codes are 6 digits and never clash with active ones", () => {
  for (let i = 0; i < 50; i++) assert.match(newPickupCode(new Set()), /^\d{6}$/);
  const inUse = new Set(["123456"]);
  for (let i = 0; i < 200; i++) assert.notEqual(newPickupCode(inUse), "123456");
});

test("Paynow statuses classify correctly", () => {
  assert.equal(classifyStatus("Paid"), "paid");
  assert.equal(classifyStatus("Awaiting Delivery"), "paid");
  assert.equal(classifyStatus("Cancelled"), "failed");
  assert.equal(classifyStatus("Sent"), "pending");
});

test("phone numbers and payment networks", () => {
  assert.equal(toLocalNumber("263771111111"), "0771111111");
  assert.equal(normalizeZwMobile("0772 123 456"), "0772123456");
  assert.equal(normalizeZwMobile("0242123456"), null);
  assert.equal(networkMatches("0772123456", "ecocash"), true);
  assert.equal(networkMatches("0712123456", "ecocash"), false);
});
