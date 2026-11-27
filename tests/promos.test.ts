import { test } from "node:test";
import assert from "node:assert/strict";
import { addToCart, type CartLine } from "../src/cart";
import { getProduct, type Product } from "../src/data";
import {
  CHECKOUT_NUDGES,
  PAIRINGS,
  SPECIALS,
  checkoutNudgeFor,
  featuredSpecial,
  pairingFor,
  specialProducts,
  withSpecialPrice,
} from "../src/promos";

function product(id: string): Product {
  const p = getProduct(id);
  assert.ok(p, id);
  return p;
}

test("every special is a real product, cheaper than its normal price", () => {
  for (const s of SPECIALS) {
    const p = product(s.productId);
    assert.equal(s.wasCents, p.priceCents, `${s.productId} 'was' price matches the catalogue`);
    assert.ok(Number.isInteger(s.priceCents) && s.priceCents > 0 && s.priceCents < s.wasCents, s.productId);
  }
  assert.equal(SPECIALS.filter((s) => s.featured).length, 1, "exactly one featured card");
});

test("the special price is what goes into the cart", () => {
  const cart: CartLine[] = [];
  addToCart(cart, withSpecialPrice(product("g04")));
  assert.equal(cart[0]?.unitCents, 350);
  addToCart(cart, withSpecialPrice(product("g01"))); // not on special
  assert.equal(cart[1]?.unitCents, 110);
});

test("featured and specials list come from SPECIALS", () => {
  assert.equal(featuredSpecial()?.productId, "g04");
  assert.deepEqual(specialProducts().map((p) => [p.id, p.priceCents]), [["g04", 350], ["g07", 360]]);
});

test("pairing suggests a partner that isn't already in the cart", () => {
  const cart: CartLine[] = [];
  addToCart(cart, product("g01"));
  assert.equal(pairingFor("g01", cart)?.id, "g04");
  assert.equal(pairingFor("g01", cart)?.priceCents, 350, "suggestion shows the special price");
  addToCart(cart, product("g04"));
  assert.equal(pairingFor("g01", cart), undefined);
  assert.equal(pairingFor("g08", cart), undefined, "no pairing defined");
});

test("every pairing and nudge points at a real product", () => {
  for (const [a, b] of Object.entries(PAIRINGS)) {
    assert.ok(getProduct(a) && getProduct(b), `${a} → ${b}`);
    assert.notEqual(a, b);
  }
  for (const id of CHECKOUT_NUDGES) assert.ok(getProduct(id), id);
});

test("checkout nudge offers the first till-side item not in the cart", () => {
  const cart: CartLine[] = [];
  assert.equal(checkoutNudgeFor(cart)?.id, "g05");
  addToCart(cart, product("g05"));
  assert.equal(checkoutNudgeFor(cart)?.id, "g03");
  addToCart(cart, product("g03"));
  assert.equal(checkoutNudgeFor(cart), undefined);
});
