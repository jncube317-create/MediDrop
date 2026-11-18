import { test } from "node:test";
import assert from "node:assert/strict";
import { centsToPaynowAmount, formatUsd, splitPayment } from "../src/money";

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

test("wallet is used first, the rest is paid by EcoCash", () => {
  assert.deepEqual(splitPayment(1240, 0), { walletCents: 0, payCents: 1240 });
  assert.deepEqual(splitPayment(1240, 150), { walletCents: 150, payCents: 1090 });
  assert.deepEqual(splitPayment(1240, 1240), { walletCents: 1240, payCents: 0 });
  assert.deepEqual(splitPayment(1240, 5000), { walletCents: 1240, payCents: 0 }); // never takes more than the total
});

test("splitPayment refuses bad amounts", () => {
  assert.throws(() => splitPayment(12.4, 0));
  assert.throws(() => splitPayment(1240, -1));
});

test("centsToPaynowAmount converts at the edge", () => {
  assert.equal(centsToPaynowAmount(1090), 10.9);
  assert.equal(centsToPaynowAmount(100), 1);
});
