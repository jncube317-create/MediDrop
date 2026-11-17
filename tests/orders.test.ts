import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, checkDeliveryCode, newDeliveryCode, transition, type Order } from "../src/orders";
import { classifyStatus, formatLocalNumber, networkMatches, normalizeZwMobile, toLocalNumber } from "../src/paystatus";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "MD-1",
    customer: "263771234567",
    customerName: "Test",
    medicineId: "m01",
    pharmacyId: "p1",
    qty: 1,
    unitCents: 150,
    deliveryCents: 200,
    zone: "CBD",
    suburb: "City Centre",
    address: "1 Main St",
    needsScript: false,
    scriptMediaId: null,
    status: "DRAFT",
    deliveryCode: "1234",
    codeAttempts: 0,
    payment: null,
    paymentAttempts: 0,
    events: [],
    createdAt: 0,
    ...overrides,
  };
}

test("allowed transitions work and are logged", () => {
  const o = makeOrder();
  assert.equal(transition(o, "AWAITING_PAYMENT", "c"), true);
  assert.equal(transition(o, "PAID", "paynow"), true);
  assert.equal(o.status, "PAID");
  assert.equal(o.events.length, 2);
  assert.deepEqual([o.events[1]?.from, o.events[1]?.to], ["AWAITING_PAYMENT", "PAID"]);
});

test("refused transitions change nothing", () => {
  const o = makeOrder();
  assert.equal(transition(o, "PAID", "x"), false); // can't skip payment
  assert.equal(o.status, "DRAFT");
  assert.equal(o.events.length, 0);
  assert.equal(canTransition("AWAITING_PHARMACIST", "AWAITING_PAYMENT"), false); // Rx needs approval first
  assert.equal(canTransition("PAID", "CANCELLED"), false);
  assert.equal(canTransition("DELIVERED", "ISSUE"), false);
});

test("Rx path needs pharmacist approval before payment", () => {
  const o = makeOrder({ needsScript: true });
  assert.equal(transition(o, "AWAITING_PHARMACIST", "c"), true);
  assert.equal(transition(o, "QUOTED", "pharmacist"), true);
  assert.equal(transition(o, "AWAITING_PAYMENT", "c"), true);
});

test("payment confirmation is idempotent", () => {
  const o = makeOrder({ status: "AWAITING_PAYMENT" });
  assert.equal(transition(o, "PAID", "paynow"), true);
  assert.equal(transition(o, "PAID", "paynow"), false); // second callback does nothing
  assert.equal(o.events.length, 1);
});

test("delivery code: correct code passes", () => {
  assert.deepEqual(checkDeliveryCode(makeOrder(), "1234"), { result: "ok" });
});

test("delivery code: 3 wrong tries locks it", () => {
  const o = makeOrder();
  assert.deepEqual(checkDeliveryCode(o, "0000"), { result: "wrong", attemptsLeft: 2 });
  assert.deepEqual(checkDeliveryCode(o, "1111"), { result: "wrong", attemptsLeft: 1 });
  assert.deepEqual(checkDeliveryCode(o, "2222"), { result: "locked" });
  assert.deepEqual(checkDeliveryCode(o, "1234"), { result: "locked" }); // even the right code after lock
});

test("delivery codes are 4 digits", () => {
  for (let i = 0; i < 50; i++) assert.match(newDeliveryCode(), /^\d{4}$/);
});

test("Paynow statuses classify correctly", () => {
  assert.equal(classifyStatus("Paid"), "paid");
  assert.equal(classifyStatus("Awaiting Delivery"), "paid");
  assert.equal(classifyStatus("Cancelled"), "failed");
  assert.equal(classifyStatus("Failed"), "failed");
  assert.equal(classifyStatus("Sent"), "pending");
  assert.equal(classifyStatus("Created"), "pending");
});

test("phone numbers convert to Paynow's local format", () => {
  assert.equal(toLocalNumber("263771111111"), "0771111111");
  assert.equal(toLocalNumber("+263 77 111 1111"), "0771111111");
  assert.equal(toLocalNumber("0771111111"), "0771111111");
});

test("typed payer numbers are cleaned or refused", () => {
  assert.equal(normalizeZwMobile("0772 123 456"), "0772123456");
  assert.equal(normalizeZwMobile("+263 78 964 5899"), "0789645899");
  assert.equal(normalizeZwMobile("772123456"), "0772123456");
  assert.equal(normalizeZwMobile("12345"), null);
  assert.equal(normalizeZwMobile("0242123456"), null); // landline
  assert.equal(normalizeZwMobile("+44 7700 900123"), null);
});

test("payer number must match the payment network", () => {
  assert.equal(networkMatches("0772123456", "ecocash"), true);
  assert.equal(networkMatches("0789645899", "ecocash"), true);
  assert.equal(networkMatches("0712123456", "ecocash"), false);
  assert.equal(networkMatches("0712123456", "onemoney"), true);
  assert.equal(networkMatches("0772123456", "onemoney"), false);
  assert.equal(formatLocalNumber("0772123456"), "0772 123 456");
});
