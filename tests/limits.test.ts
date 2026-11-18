import { test } from "node:test";
import assert from "node:assert/strict";
import { validateButtons, validateCarousel, validateList, validateText } from "../src/limits";

test("buttons: 1-3 allowed, titles max 20", () => {
  assert.equal(validateButtons("Pick", [{ id: "a", title: "Yes" }]), null);
  assert.notEqual(validateButtons("Pick", []), null);
  assert.notEqual(
    validateButtons("Pick", [1, 2, 3, 4].map((n) => ({ id: `${n}`, title: `${n}` }))),
    null,
  );
  assert.equal(validateButtons("Pick", [{ id: "a", title: "x".repeat(20) }]), null);
  assert.notEqual(validateButtons("Pick", [{ id: "a", title: "x".repeat(21) }]), null);
});

test("list: max 10 rows, title 24, description 72", () => {
  const ok = [{ id: "a", title: "x".repeat(24), description: "y".repeat(72) }];
  assert.equal(validateList("Body", "Menu", "Options", ok), null);
  assert.notEqual(validateList("Body", "Menu", "Options", [{ id: "a", title: "x".repeat(25) }]), null);
  assert.notEqual(validateList("Body", "Menu", "Options", [{ id: "a", title: "t", description: "y".repeat(73) }]), null);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ id: `${i}`, title: `${i}` }));
  assert.notEqual(validateList("Body", "Menu", "Options", eleven), null);
  assert.notEqual(validateList("Body", "x".repeat(21), "Options", ok), null);
});

test("text: not empty, max 4096", () => {
  assert.equal(validateText("hi"), null);
  assert.notEqual(validateText(""), null);
  assert.notEqual(validateText("x".repeat(4097)), null);
});

test("carousel: 2-10 cards, https images, short card text, same buttons on every card", () => {
  const card = (t = "x") => ({ imageUrl: "https://a.b/m01.jpg", text: t, buttons: [{ id: "med:m01", title: "Choose" }] });
  assert.equal(validateCarousel("Pick one", [card(), card()]), null);
  assert.notEqual(validateCarousel("Pick one", [card()]), null);
  assert.notEqual(validateCarousel("Pick one", Array.from({ length: 11 }, () => card())), null);
  assert.notEqual(validateCarousel("Pick one", [card("y".repeat(161)), card()]), null);
  assert.notEqual(validateCarousel("Pick one", [card("a\nb\nc\nd"), card()]), null);
  assert.notEqual(validateCarousel("Pick one", [{ ...card(), imageUrl: "http://a.b/x.jpg" }, card()]), null);
  assert.notEqual(validateCarousel("Pick one", [card(), { ...card(), buttons: [] }]), null);
  assert.notEqual(validateCarousel("", [card(), card()]), null);
});
