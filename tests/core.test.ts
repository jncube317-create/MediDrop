import { test } from "node:test";
import assert from "node:assert/strict";
import { eligible, keywords, level, profileScore, quoteCents, rankItems, rankProviders, type ListingLike, type NeedLike } from "../src/match";
import { Ledger } from "../src/credits";
import { canMove, isStale, moveLead, prettyPhone, chatLink, LEAD_TTL_MS, type Lead } from "../src/leads";
import {
  BUNDLES, CATEGORIES, CITIES, SAMPLE_ADS, SAMPLE_LISTINGS, SAMPLE_SELLERS, bannedWord, categoriesOf, fit, getCategory, parseDollars,
} from "../src/data";
import { LIMITS } from "../src/limits";
import { existsSync } from "node:fs";

const listing = (o: Partial<ListingLike> & { id: string }): ListingLike => ({
  owner: `p-${o.id}`, category: "cars", city: "byo", nationwide: false, title: "Toyota Vitz", text: "clean car",
  active: true, sold: false, priceCents: 300000, ratingSum: 0, ratingCount: 0, ...o,
});
const need: NeedLike = { owner: "buyer", category: "cars", city: "byo", anywhere: false, text: "Toyota Vitz under 3000", budgetCents: 300000 };

// ---------------------------------------------------------------- matching

test("keywords drop filler words, numbers and short words", () => {
  assert.deepEqual(keywords("I need someone to FIX my wardrobe door under 3000"), ["wardrobe", "door"]);
});

test("eligible: same category, live, not yours, reachable town", () => {
  assert.ok(eligible(need, listing({ id: "a" })));
  assert.ok(!eligible(need, listing({ id: "b", category: "fashion" })));
  assert.ok(!eligible(need, listing({ id: "c", owner: "buyer" })), "never your own listing");
  assert.ok(!eligible(need, listing({ id: "d", sold: true })), "sold items are hidden");
  assert.ok(!eligible(need, listing({ id: "e", active: false })));
  assert.ok(!eligible(need, listing({ id: "f", city: "hre" })), "Harare sellers don't show for a Bulawayo post");
  assert.ok(eligible(need, listing({ id: "g", city: "hre", nationwide: true })), "unless they sell nationwide");
  assert.ok(eligible({ ...need, anywhere: true }, listing({ id: "h", city: "hre" })), "or the buyer chose anywhere");
});

test("item cards: matching words first, then within budget, then cheapest", () => {
  const bmw = listing({ id: "bmw", title: "BMW 745i", priceCents: 550000 });
  const vitzDear = listing({ id: "vitz2", title: "Toyota Vitz 2012", priceCents: 420000 });
  const vitzCheap = listing({ id: "vitz1", title: "Toyota Vitz 2010", priceCents: 290000 });
  const np = listing({ id: "np", title: "Nissan NP300", priceCents: 250000 });
  assert.deepEqual(rankItems(need, [bmw, vitzDear, np, vitzCheap], 9).map((l) => l.id), ["vitz1", "vitz2", "np", "bmw"]);
});

test("item cards respect the limit", () => {
  const many = Array.from({ length: 12 }, (_, i) => listing({ id: `x${i}` }));
  assert.equal(rankItems(need, many, 9).length, 9);
});

test("providers: same town first, skip ones already sent", () => {
  const job: NeedLike = { owner: "c", category: "painting", city: "byo", anywhere: false, text: "paint 6 rooms dulux", budgetCents: null };
  const near = listing({ id: "near", category: "painting", text: "interior painting" });
  const far = listing({ id: "far", category: "painting", city: "hre", nationwide: true, text: "dulux paint rooms" });
  assert.equal(rankProviders(job, [far, near], new Set(), 5)[0]?.id, "near");
  assert.deepEqual(rankProviders(job, [far, near], new Set(["near"]), 5).map((l) => l.id), ["far"]);
});

test("quotes sort by their first dollar amount", () => {
  assert.equal(quoteCents("$850, paint included, 4 days"), 85000);
  assert.equal(quoteCents("1,200 including transport"), 120000);
  assert.equal(quoteCents(null), Infinity);
});

test("seller levels", () => {
  assert.equal(level(0, 0), "New");
  assert.equal(level(1, 3), "Bronze");
  assert.equal(level(5, 4.2), "Silver");
  assert.equal(level(25, 4.7), "Gold");
  assert.equal(level(25, 4.2), "Silver", "Gold needs a high rating too");
});

test("listing score rewards photos first", () => {
  assert.deepEqual(profileScore({ photos: 0, text: "", hasPrice: true, verified: false }), { score: 20, tip: "Add photos to get far more interest." });
  assert.equal(profileScore({ photos: 2, text: "x".repeat(50), hasPrice: true, verified: true }).score, 100);
});

// ---------------------------------------------------------------- credits

test("welcome credits are given once per number", () => {
  const l = new Ledger();
  assert.ok(l.welcome("p1", 3));
  assert.ok(!l.welcome("p1", 3));
  assert.equal(l.balance("p1"), 3);
});

test("holds of several credits: need the balance, release gives all back", () => {
  const l = new Ledger();
  l.welcome("p1", 3);
  assert.ok(!l.hold("p1", "L1:c", 4), "not enough for a 4-credit swap");
  assert.ok(l.hold("p1", "L1:c", 3));
  assert.equal(l.balance("p1"), 0);
  assert.ok(l.release("L1:c"));
  assert.equal(l.balance("p1"), 3);
  assert.ok(!l.release("L1:c"), "release is once only");
});

test("captured holds stay spent and can't be released", () => {
  const l = new Ledger();
  l.welcome("p1", 3);
  l.hold("p1", "L1", 1);
  assert.ok(l.capture("L1"));
  assert.ok(!l.release("L1"));
  assert.ok(!l.capture("L1"));
  assert.equal(l.balance("p1"), 2);
});

test("the same payment can't add credits twice", () => {
  const l = new Ledger();
  assert.ok(l.purchase("p1", 5, "PAY-1"));
  assert.ok(!l.purchase("p1", 5, "PAY-1"));
  assert.equal(l.balance("p1"), 5);
  assert.throws(() => l.purchase("p1", 0, "PAY-2"));
});

test("ad taps: spend once per key, refuse when broke", () => {
  const l = new Ledger();
  l.grant("shop", 1, "g1");
  assert.ok(l.spend("shop", 1, "adtap:AD-1:buyer"));
  assert.ok(!l.spend("shop", 1, "adtap:AD-1:buyer"), "same buyer tapping again is free");
  assert.ok(l.hasSpent("adtap:AD-1:buyer"));
  assert.ok(!l.spend("shop", 1, "adtap:AD-1:other"), "no credits left");
  assert.equal(l.balance("shop"), 0);
});

// ---------------------------------------------------------------- leads

const lead = (): Lead => ({
  id: "L1", needId: "N1", offerId: "O1", provider: "p", customer: "c", origin: "need", cost: 1, quote: null,
  status: "OFFERED", createdAt: 0, updatedAt: 0, rated: false, reported: false,
});

test("allowed lead moves", () => {
  const l = lead();
  assert.ok(moveLead(l, "INTERESTED"));
  assert.ok(moveLead(l, "CONNECTED"));
  assert.equal(l.status, "CONNECTED");
});

test("refused lead moves change nothing", () => {
  const l = lead();
  assert.ok(!moveLead(l, "CONNECTED"), "can't connect before interest");
  assert.equal(l.status, "OFFERED");
  moveLead(l, "PASSED");
  assert.ok(!moveLead(l, "INTERESTED"));
  assert.ok(!canMove("CONNECTED", "DECLINED"));
});

test("open leads go stale after 48 hours, finished ones never", () => {
  const l = lead();
  assert.ok(!isStale(l, LEAD_TTL_MS - 1));
  assert.ok(isStale(l, LEAD_TTL_MS + 1));
  l.status = "CONNECTED";
  assert.ok(!isStale(l, LEAD_TTL_MS * 10));
});

test("phone numbers are shown nicely", () => {
  assert.equal(prettyPhone("263771234567"), "+263 77 123 4567");
  assert.equal(chatLink("+263 77 123 4567"), "https://wa.me/263771234567");
});

// ---------------------------------------------------------------- data

test("categories, towns and bundles fit WhatsApp limits", () => {
  for (const kind of ["item", "service"] as const) assert.ok(categoriesOf(kind).length <= LIMITS.listRowsMax, kind);
  assert.ok(CITIES.length <= LIMITS.listRowsMax);
  for (const c of CATEGORIES) {
    assert.ok(c.name.length <= LIMITS.listRowTitle, c.name);
    assert.ok(Number.isInteger(c.swapCost) && c.swapCost >= 1);
  }
  for (const c of CITIES) assert.ok(c.name.length <= LIMITS.listRowTitle, c.name);
  for (const b of BUNDLES) assert.ok(Number.isInteger(b.cents) && b.cents >= 200, "smallest bundle is $2 so fees don't eat it");
  assert.equal(getCategory("cars")?.swapCost, 1, "launch pricing: every swap costs 1 credit");
});

test("money parsing", () => {
  assert.equal(parseDollars("$5,500"), 550000);
  assert.equal(parseDollars("US$ 520.50"), 52050);
  assert.equal(parseDollars("3k"), 300000);
  assert.equal(parseDollars("not sure"), null);
});

test("illegal posts are caught, normal ones aren't", () => {
  assert.equal(bannedWord("Selling dagga cheap"), "dagga");
  assert.equal(bannedWord("Fake ID for sale!"), "fake id");
  assert.equal(bannedWord("Steel door, charcoal"), null);
  assert.equal(bannedWord("Gun-metal grey fridge"), null);
});

test("sample data is complete and safe", () => {
  const sellers = new Set(SAMPLE_SELLERS.map((s) => s.phone));
  for (const s of SAMPLE_SELLERS) assert.match(s.phone, /^26300/, "sample numbers can never be real mobiles");
  for (const l of SAMPLE_LISTINGS) {
    assert.ok(sellers.has(l.seller), l.title);
    assert.equal(getCategory(l.category)?.kind, l.kind, l.title);
    assert.ok(l.ratingSum <= l.ratingCount * 5, l.title);
    if (l.kind === "item") assert.ok(l.priceCents && l.condition, `${l.title} needs a price and condition`);
    if (l.photo) assert.ok(existsSync(`public/demo/${l.photo}`), `missing photo ${l.photo}`);
  }
  for (const a of SAMPLE_ADS) {
    assert.ok(sellers.has(a.owner));
    assert.ok(existsSync(`public/demo/${a.photo}`));
  }
});

test("fit shortens with an ellipsis", () => {
  assert.equal(fit("short", 24), "short");
  const cut = fit("Need: a very long description of a job", 24);
  assert.equal(cut.length, 24);
  assert.ok(cut.endsWith("…"));
});

test("ledger: saved entries restore the same balance after a restart, without double counting", () => {
  const a = new Ledger();
  a.welcome("263770000001", 3);
  a.hold("263770000001", "L1", 1);
  a.capture("L1");
  const saved = a.all().map((e) => ({ ...e }));
  const b = new Ledger();
  b.load(saved);
  b.load(saved); // loading twice changes nothing
  assert.equal(b.balance("263770000001"), 2);
  assert.equal(b.welcome("263770000001", 3), false, "welcome credits are never given twice, even after a restart");
  assert.equal(b.isHeld("L1"), false);
});
