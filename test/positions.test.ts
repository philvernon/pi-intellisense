import test from "node:test";
import assert from "node:assert/strict";
import { lspToNvimByteColumn, visualToLspCharacter } from "../src/positions.ts";

test("PO-01: ASCII UTF-16 column maps unchanged", () => {
  assert.equal(lspToNvimByteColumn("hello", 3, "utf-16"), 3);
});
test("PO-02: UTF-16 column counts accent and astral emoji correctly", () => {
  assert.equal(lspToNvimByteColumn("é🙂x", 3, "utf-16"), 6);
  assert.equal(lspToNvimByteColumn("é🙂x", 4, "utf-16"), 7);
});
test("PO-03: rejects offset inside UTF-16 surrogate pair", () => {
  assert.throws(
    () => lspToNvimByteColumn("a🙂b", 2, "utf-16"),
    /surrogate|invalid|boundary/i,
  );
});
test("PO-04: rejects out-of-range or negative offsets", () => {
  assert.throws(() => lspToNvimByteColumn("x", 2), /range|invalid/i);
  assert.throws(() => lspToNvimByteColumn("x", -1), /range|invalid/i);
});
test("PO-05: utf-8 negotiated byte position is not double encoded", () => {
  assert.equal(lspToNvimByteColumn("é🙂x", 6, "utf-8"), 6);
});
test("PO-06: terminal tabs expand visually but map to one LSP character", () => {
  assert.equal(visualToLspCharacter("a\tb", 4, { tabSize: 4 }), 2);
});
test("PO-07: wide character and emoji visual cells map to UTF-16 offsets", () => {
  assert.equal(visualToLspCharacter("a界b", 3, { tabSize: 4 }), 2);
  assert.equal(visualToLspCharacter("a🙂b", 3, { tabSize: 4 }), 3);
});
test("PO-08: combining accent occupies no extra screen column", () => {
  assert.equal(visualToLspCharacter("e\u0301x", 1, { tabSize: 4 }), 2);
});
