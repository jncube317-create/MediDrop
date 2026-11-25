import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { type Product, applyPrices, livePrices, matchScore, parsePriceLine, searchProducts, productCategory, ageLabel } from "../src/catalog";
import { readPriceSheet } from "../src/sheet";

const DAY = 24 * 3600_000;
const mk = (id: string, name: string, category = "groceries"): Product => ({ id, name, category, photo: null, prices: {}, createdAt: 0 });

test("price lines: common ways shops type prices", () => {
  assert.deepEqual(parsePriceLine("Olivine cooking oil 2L 3.80"), { name: "Olivine cooking oil 2L", cents: 380 });
  assert.deepEqual(parsePriceLine("Gold Leaf mealie meal 10kg - $7.50"), { name: "Gold Leaf mealie meal 10kg", cents: 750 });
  assert.deepEqual(parsePriceLine("Sugar 2kg: 2,90"), { name: "Sugar 2kg", cents: 290 });
  assert.equal(parsePriceLine("Olivine cooking oil"), null);
  assert.equal(parsePriceLine("3.80"), null);
});

test("sizes must match exactly; small typos are fine", () => {
  const oil2 = mk("PR-1", "Olivine cooking oil 2L");
  assert.ok(matchScore("olivne cooking oil 2 L", oil2) >= 0.6);
  assert.equal(matchScore("Olivine cooking oil 5L", oil2), 0);
});

test("applyPrices updates known products and reports unknown ones", () => {
  const list = [mk("PR-1", "Olivine cooking oil 2L"), mk("PR-2", "Gold Leaf mealie meal 10kg")];
  const r = applyPrices("263771", [{ name: "olivine cooking oil 2l", cents: 380 }, { name: "Mazoe orange 2L", cents: 450 }], list, 1000);
  assert.equal(r.updated.length, 1);
  assert.equal(list[0]!.prices["263771"]?.cents, 380);
  assert.deepEqual(r.unknown, ["Mazoe orange 2L 4.50"]);
});

test("comparison is cheapest first, flags stale prices and hides old ones", () => {
  const now = 100 * DAY;
  const p = mk("PR-1", "Olivine cooking oil 2L");
  p.prices = { a: { cents: 400, at: now }, b: { cents: 350, at: now - 20 * DAY }, c: { cents: 300, at: now - 40 * DAY } };
  const live = livePrices(p, now);
  assert.deepEqual(live.map((x) => x.shop), ["b", "a"]);
  assert.equal(live[0]!.stale, true);
  assert.equal(ageLabel(now - 3 * DAY, now), "updated 3 days ago");
});

test("search finds products by plain words, respects sizes", () => {
  const list = [mk("PR-1", "Olivine cooking oil 2L"), mk("PR-2", "Pure Drop cooking oil 5L"), mk("PR-3", "Brake pads front Toyota Hilux", "carparts")];
  assert.deepEqual(searchProducts("cooking oil", list).map((p) => p.id).sort(), ["PR-1", "PR-2"]);
  assert.deepEqual(searchProducts("cheapest cooking oil 5l", list).map((p) => p.id), ["PR-2"]);
  assert.deepEqual(searchProducts("brake pads hilux", list).map((p) => p.id), ["PR-3"]);
});

test("new products default to groceries unless they're car parts", () => {
  assert.equal(productCategory("Huletts white sugar 2kg"), "groceries");
  assert.equal(productCategory("Brake pads front Toyota Hilux"), "carparts");
});

test("spreadsheet and CSV price lists are read", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Prices");
  ws.addRow(["Product", "Price"]);
  ws.addRow(["Olivine cooking oil 2L", 3.8]);
  ws.addRow(["", ""]);
  ws.addRow(["Gold Leaf mealie meal 10kg", "$7.50"]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  assert.deepEqual(await readPriceSheet(xlsx, "prices.xlsx", ""), [
    { name: "Olivine cooking oil 2L", cents: 380 },
    { name: "Gold Leaf mealie meal 10kg", cents: 750 },
  ]);
  const csv = Buffer.from("Product,Price\nSugar 2kg,2.90\nRice 2kg;3.10\n");
  assert.deepEqual(await readPriceSheet(csv, "p.csv", "text/csv"), [
    { name: "Sugar 2kg", cents: 290 },
    { name: "Rice 2kg", cents: 310 },
  ]);
});

test("missing size gets a suggestion, not 'unknown'", async () => {
  const { sizeHint, cleanProductName } = await import("../src/catalog");
  const list = [mk("PR-1", "Olivine cooking oil 2L")];
  assert.equal(sizeHint("Olivine cooking oil", list)?.id, "PR-1");
  assert.equal(sizeHint("Olivine cooking oil 5L", list), null);
  const r = applyPrices("s", [{ name: "Olivine cooking oil", cents: 270 }, { name: "Mazoe orange crush", cents: 350 }], list);
  assert.deepEqual(r.needsSize, [{ line: "Olivine cooking oil", example: "Olivine cooking oil 2L 2.70" }]);
  assert.deepEqual(r.unknownRows, [{ name: "Mazoe orange crush", cents: 350 }]);
  assert.equal(cleanProductName("< Olivine Cooking Oil 2 litre>"), "Olivine Cooking Oil 2 litre");
});
