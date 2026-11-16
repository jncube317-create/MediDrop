import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToPaynowAmount, formatUsd, orderTotals } from "../src/money";

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

test("orderTotals adds medicine x qty + delivery in cents", () => {
  assert.deepEqual(orderTotals(150, 2, 300), { medicineCents: 300, deliveryCents: 300, totalCents: 600 });
  assert.deepEqual(orderTotals(199, 3, 200), { medicineCents: 597, deliveryCents: 200, totalCents: 797 });
});

test("orderTotals refuses bad quantities and prices", () => {
  assert.throws(() => orderTotals(150, 0, 200));
  assert.throws(() => orderTotals(150, 1.5, 200));
  assert.throws(() => orderTotals(1.5, 1, 200));
  assert.throws(() => orderTotals(150, 1, -200));
});

test("centsToPaynowAmount converts at the edge", () => {
  assert.equal(centsToPaynowAmount(797), 7.97);
  assert.equal(centsToPaynowAmount(100), 1);
});
