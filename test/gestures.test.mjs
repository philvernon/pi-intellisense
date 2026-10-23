import test from "node:test";
import assert from "node:assert/strict";

async function sut() {
  return import("../src/bridge/gestures.ts");
}
const visual = {mode:"visual", cursor:{row:12,col:9}, enabled:true};

test("K requests LSP hover only with a visual code cursor", async () => {
  const {parseSemanticGesture} = await sut();
  assert.deepEqual(parseSemanticGesture(["K"],visual), {consumed:true,operation:"hover"});
  assert.equal(parseSemanticGesture(["K"],{mode:"item",enabled:true}).consumed,false,
    "item-mode K must continue navigating to previous transcript item");
  assert.equal(parseSemanticGesture(["K"],{mode:"editor",enabled:true}).consumed,false,
    "must never insert/steal an editor key");
});

test("gd, gD, gi, gy, gr are exact Vim semantic motions", async () => {
  const {parseSemanticGesture} = await sut();
  for (const [seq, operation] of [
    ["gd","definition"],["gD","declaration"],["gi","implementation"],
    ["gy","typeDefinition"],["gr","references"]
  ]) {
    const response = parseSemanticGesture([...seq],visual);
    assert.equal(response.consumed,true,seq);
    assert.equal(response.operation,operation,seq);
  }
  assert.equal(parseSemanticGesture(["g"],visual).pending,true);
});

test("gg and ge remain controlled by pi-tab-focus, never hijacked", async () => {
  const {parseSemanticGesture} = await sut();
  for (const seq of [["g","g"],["g","e"],["g","E"],["y"],["v"],["V"],["K","K"]]) {
    assert.equal(parseSemanticGesture(seq,visual).operation,undefined,seq.join(""));
  }
});

test("diagnostic motion, signature, symbol and completion gestures", async () => {
  const {parseSemanticGesture} = await sut();
  for (const [keys,operation] of [
    [["[","d"],"previousDiagnostic"],
    [["]","d"],"nextDiagnostic"],
    [["ctrl+k"],"signatureHelp"],
    [["ctrl+space"],"completion"],
    [["g","s"],"documentSymbols"]
  ]) {
    assert.equal(parseSemanticGesture(keys,visual).operation,operation,keys.join(""));
  }
});

test("no interception while popup, no cursor or feature disabled", async () => {
  const {parseSemanticGesture} = await sut();
  for (const context of [
    {...visual,popupFocused:true},
    {...visual,cursor:undefined},
    {...visual,enabled:false}
  ]) {
    assert.equal(parseSemanticGesture(["K"],context).consumed,false);
    assert.equal(parseSemanticGesture(["g","d"],context).consumed,false);
  }
});
