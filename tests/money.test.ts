import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToPaynowAmount, formatUsd } from "../src/money";

test("formatUsd shows two decimals", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(5), "$0.05");
  assert.equal(formatUsd(350), "$3.50");
  assert.equal(formatUsd(123456), "$1234.56");
});

test("formatUsd refuses floats and negatives", () => {
  assert.throws(() => formatUsd(3.5));
  assert.throws(() => formatUsd(-1));
});

test("centsToPaynowAmount converts at the edge", () => {
  assert.equal(centsToPaynowAmount(1090), 10.9);
  assert.equal(centsToPaynowAmount(100), 1);
});

test("paynow statuses are classified safely", async () => {
  const { classifyStatus, normalizeZwMobile } = await import("../src/paystatus");
  assert.equal(classifyStatus("Paid"), "paid");
  assert.equal(classifyStatus("Awaiting Delivery"), "paid");
  assert.equal(classifyStatus("Cancelled"), "failed");
  assert.equal(classifyStatus("Sent"), "pending");
  assert.equal(normalizeZwMobile("+263 77 123 4567"), "0771234567");
  assert.equal(normalizeZwMobile("12345"), null);
});
