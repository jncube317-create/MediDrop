import { test } from "node:test";
import assert from "node:assert/strict";
import { addToCart, cartLines, cartTotal, itemCount, removeOne, type CartLine } from "../src/cart";
import { getProduct, type Product } from "../src/data";

function product(id: string): Product {
  const p = getProduct(id);
  assert.ok(p, id);
  return p;
}

test("adding the same product twice adds to one line", () => {
  const cart: CartLine[] = [];
  assert.equal(addToCart(cart, product("g04")).ok, true); // Mazoe $4.00
  assert.equal(addToCart(cart, product("g04")).ok, true);
  assert.equal(addToCart(cart, product("g01")).ok, true); // bread $1.10
  assert.equal(cart.length, 2);
  assert.equal(itemCount(cart), 3);
  assert.equal(cartTotal(cart), 400 * 2 + 110);
  assert.equal(cartLines(cart), "2 × Mazoe Orange Crush 2L  $8.00\n1 × Proton White Loaf  $1.10");
});

test("out-of-stock items can't be added", () => {
  const cart: CartLine[] = [];
  assert.deepEqual(addToCart(cart, { ...product("g05"), inStock: false }), { ok: false, reason: "out_of_stock" });
  assert.equal(cart.length, 0);
});

test("per-order limit is enforced", () => {
  const cart: CartLine[] = [];
  const potatoes = product("g02"); // max 3
  assert.equal(addToCart(cart, potatoes, 3).ok, true);
  assert.deepEqual(addToCart(cart, potatoes), { ok: false, reason: "max_qty" });
  assert.equal(cart[0]?.qty, 3);
});

test("price is copied into the cart when added", () => {
  const cart: CartLine[] = [];
  const copy = { ...product("g03") };
  addToCart(cart, copy);
  copy.priceCents = 999; // a later price edit
  assert.equal(cart[0]?.unitCents, 50);
});

test("removeOne takes one off, then removes the line", () => {
  const cart: CartLine[] = [];
  addToCart(cart, product("g08"), 2);
  assert.equal(removeOne(cart, "g08"), true);
  assert.equal(cart[0]?.qty, 1);
  assert.equal(removeOne(cart, "g08"), true);
  assert.equal(cart.length, 0);
  assert.equal(removeOne(cart, "g08"), false);
});

test("bad quantities are refused", () => {
  assert.throws(() => addToCart([], product("g01"), 0));
  assert.throws(() => addToCart([], product("g01"), 1.5));
});
