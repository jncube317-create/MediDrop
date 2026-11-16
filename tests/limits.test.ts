import { test } from "node:test";
import assert from "node:assert/strict";
import { validateButtons, validateList, validateText } from "../src/limits";

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
