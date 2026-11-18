import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { CATEGORIES, PRODUCTS, findProducts, productImageUrl, productsIn } from "../src/data";
import { qrText } from "../src/qr";

test("search finds everyday names, brands and typos", () => {
  assert.equal(findProducts("bread")[0]?.id, "g01");
  assert.equal(findProducts("mazoe")[0]?.id, "g04");
  assert.equal(findProducts("chocolate")[0]?.id, "g05");
  assert.equal(findProducts("fabric softener")[0]?.id, "g06");
  assert.equal(findProducts("omo")[0]?.id, "g07");
  assert.equal(findProducts("deodorant")[0]?.id, "g08");
  assert.equal(findProducts("potatos")[0]?.id, "g02"); // typo
  assert.equal(findProducts("xyzzy").length, 0);
});

test("every section has 2-10 products (a carousel needs 2-10 cards)", () => {
  for (const c of CATEGORIES) {
    const n = productsIn(c.key).length;
    assert.ok(n >= 2 && n <= 10, `${c.key}: ${n}`);
  }
});

test("catalogue fits WhatsApp limits", () => {
  assert.ok(CATEGORIES.length <= 10);
  for (const c of CATEGORIES) {
    assert.ok(c.name.length <= 24, c.name);
    assert.ok(c.blurb.length <= 72, c.blurb);
  }
  for (const p of PRODUCTS) {
    assert.ok(p.name.length <= 24, p.name);
    assert.ok(Number.isInteger(p.priceCents) && p.priceCents > 0, p.id);
    assert.ok(new Set(PRODUCTS.map((x) => x.id)).size === PRODUCTS.length);
  }
});

test("every product has a sample picture", () => {
  for (const p of PRODUCTS) assert.ok(existsSync(`public/img/${p.id}.jpg`), p.id);
});

test("image links only when the server has a public https address", () => {
  assert.equal(productImageUrl("https://greens.up.railway.app", "g01"), "https://greens.up.railway.app/img/g01.jpg");
  assert.equal(productImageUrl("", "g01"), null);
});

test("QR holds only the order number and pickup code", () => {
  assert.equal(qrText("GR-2041", "483920"), "GREENS:GR-2041:483920");
});

test("every product has a short description for its card", () => {
  for (const p of PRODUCTS) {
    assert.ok(p.blurb.length >= 20 && p.blurb.length <= 160, `${p.id}: ${p.blurb.length}`);
  }
});
