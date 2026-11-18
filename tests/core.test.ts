import { test } from "node:test";
import assert from "node:assert/strict";
import { keywords, pickMatches, score, type OfferLike } from "../src/match";
import { Ledger } from "../src/credits";
import { canMove, isStale, moveLead, prettyPhone, chatLink, LEAD_TTL_MS, type Lead } from "../src/leads";
import { AREAS, BUNDLES, CATEGORIES, SAMPLE_PROVIDERS, fit, getArea, getCategory } from "../src/data";
import { LIMITS } from "../src/limits";

const offer = (o: Partial<OfferLike> & { id: string }): OfferLike => ({
  owner: `p-${o.id}`,
  category: "carpentry",
  area: "west",
  coversAll: false,
  text: "wardrobes and doors",
  active: true,
  ratingSum: 0,
  ratingCount: 0,
  ...o,
});
const need = { owner: "customer", category: "carpentry", area: "west", text: "Fix my wardrobe door hinges" };

// ---------------------------------------------------------------- matching

test("keywords drop filler words and short words", () => {
  assert.deepEqual(keywords("I need someone to FIX my wardrobe door"), ["wardrobe", "door"]);
});

test("a different category never matches", () => {
  assert.equal(score(need, offer({ id: "a", category: "plumbing" })), null);
});

test("a provider never gets their own post", () => {
  assert.equal(score(need, offer({ id: "a", owner: "customer" })), null);
});

test("paused listings get nothing", () => {
  assert.equal(score(need, offer({ id: "a", active: false })), null);
});

test("other areas only match providers who cover all of Bulawayo", () => {
  assert.equal(score(need, offer({ id: "a", area: "east" })), null);
  assert.notEqual(score(need, offer({ id: "b", area: "east", coversAll: true })), null);
});

test("same area beats far away, and matching words count", () => {
  const near = offer({ id: "near", text: "kitchen units" });
  const far = offer({ id: "far", area: "east", coversAll: true, text: "kitchen units" });
  const words = offer({ id: "words", area: "east", coversAll: true, text: "wardrobe door repairs" });
  assert.ok((score(need, near) ?? 0) > (score(need, far) ?? 0));
  assert.ok((score(need, words) ?? 0) > (score(need, far) ?? 0));
});

test("better ratings break ties", () => {
  const good = offer({ id: "good", ratingSum: 50, ratingCount: 10 });
  const plain = offer({ id: "plain" });
  assert.deepEqual(pickMatches(need, [plain, good], new Set(), 5).map((o) => o.id), ["good", "plain"]);
});

test("pickMatches respects the limit and skips providers already sent", () => {
  const offers = ["a", "b", "c", "d"].map((id) => offer({ id }));
  assert.equal(pickMatches(need, offers, new Set(), 2).length, 2);
  assert.deepEqual(pickMatches(need, offers, new Set(["a", "b", "c"]), 5).map((o) => o.id), ["d"]);
});

// ---------------------------------------------------------------- credits

test("welcome credits are given once per number", () => {
  const l = new Ledger();
  assert.ok(l.welcome("p1", 3));
  assert.ok(!l.welcome("p1", 3));
  assert.equal(l.balance("p1"), 3);
});

test("a hold needs a credit", () => {
  const l = new Ledger();
  assert.ok(!l.hold("p1", "L1"));
  l.welcome("p1", 1);
  assert.ok(l.hold("p1", "L1"));
  assert.equal(l.balance("p1"), 0);
  assert.ok(!l.hold("p1", "L2"), "no credit left for a second lead");
});

test("captured holds stay spent, released holds come back, never twice", () => {
  const l = new Ledger();
  l.welcome("p1", 3);
  l.hold("p1", "L1");
  l.hold("p1", "L2");
  assert.equal(l.balance("p1"), 1);
  assert.ok(l.capture("L1"));
  assert.ok(!l.release("L1"), "can't release after capture");
  assert.ok(l.release("L2"));
  assert.ok(!l.release("L2"), "release is once only");
  assert.ok(!l.capture("L2"), "can't capture after release");
  assert.equal(l.balance("p1"), 2);
});

test("the same payment can't add credits twice", () => {
  const l = new Ledger();
  assert.ok(l.purchase("p1", 5, "PAY-1"));
  assert.ok(!l.purchase("p1", 5, "PAY-1"));
  assert.equal(l.balance("p1"), 5);
  assert.throws(() => l.purchase("p1", 0, "PAY-2"));
});

test("holding the same lead twice does nothing", () => {
  const l = new Ledger();
  l.welcome("p1", 3);
  assert.ok(l.hold("p1", "L1"));
  assert.ok(!l.hold("p1", "L1"));
  assert.equal(l.balance("p1"), 2);
});

// ---------------------------------------------------------------- leads

const lead = (): Lead => ({
  id: "L1", needId: "N1", offerId: "O1", provider: "p", customer: "c",
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
  assert.ok(!moveLead(l, "CONNECTED"), "can't connect before the provider is interested");
  assert.equal(l.status, "OFFERED");
  moveLead(l, "PASSED");
  assert.ok(!moveLead(l, "INTERESTED"), "a passed lead stays passed");
  assert.ok(!canMove("CONNECTED", "DECLINED"));
  assert.ok(!canMove("EXPIRED", "INTERESTED"));
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

// ---------------------------------------------------------------- data fits WhatsApp

test("categories, areas and bundles fit WhatsApp list limits", () => {
  assert.ok(CATEGORIES.length <= LIMITS.listRowsMax);
  assert.ok(AREAS.length <= LIMITS.listRowsMax);
  for (const c of CATEGORIES) assert.ok(c.name.length <= LIMITS.listRowTitle, c.name);
  for (const a of AREAS) assert.ok(a.name.length <= LIMITS.listRowTitle, a.name);
  for (const b of BUNDLES) {
    assert.ok(Number.isInteger(b.cents) && b.cents > 0);
    assert.ok(Number.isInteger(b.credits) && b.credits > 0);
  }
});

test("sample providers use real categories and areas and fake numbers", () => {
  for (const p of SAMPLE_PROVIDERS) {
    assert.ok(getCategory(p.category), p.name);
    assert.ok(getArea(p.area), p.name);
    assert.match(p.phone, /^26300/, "sample numbers can never be real mobiles");
    assert.ok(p.ratingSum <= p.ratingCount * 5);
  }
});

test("fit shortens with an ellipsis", () => {
  assert.equal(fit("short", 24), "short");
  const cut = fit("Need: a very long description of a job", 24);
  assert.equal(cut.length, 24);
  assert.ok(cut.endsWith("…"));
});
