import test from "node:test";
import assert from "node:assert/strict";

/** NT-01..04, NT-07, NT-09: integrated native entrypoints, not /intel. */
async function native() { return import("../../src/native/native-controller.ts"); }
function fixture(overrides = {}) {
  const seen = { lsp: [], overlay: [], opened: [], notifications: [], model: [], replaced: 0 };
  const snapshot = {
    version: 1, sessionId: "s1", itemSemanticKey: "assistant:2",
    transcriptRevision: "rev:5", layoutRevision: "layout:8",
    selectedCodeRegionId: "code:0",
    visualCursor: { row: 51, col: 17 }, screenCursor: { row: 13, col: 17 }
  };
  const anchor = { uri: "file:///project/src/total.ts", position: { line: 19, character: 12 },
    fileHash: "v8", token: "calculateTotal", confidence: "verified" };
  let sessionId = "s1", version = "rev:5";
  const ui = {
    custom(_factory, options) { seen.overlay.push(options); return Promise.resolve(null); },
    notify(message) { seen.notifications.push(message); },
    setEditorComponent() { seen.replaced++; throw new Error("transcript replacement forbidden"); },
    sendUserMessage(message) { seen.model.push(message); }
  };
  const lsp = { async query(request) {
    seen.lsp.push(request);
    if(request.kind === "hover") return { contents: { kind: "markdown", value: "calculateTotal(): number" } };
    return { uri: "file:///project/src/math.ts",
      range: { start: { line: 10, character: 4 }, end: { line: 10, character: 18 } } };
  }};
  const neovim = { async open(target) { seen.opened.push(target); } };
  return {
    seen, snapshot, anchor, ui, lsp, neovim,
    resolveSymbol: async () => anchor,
    getSession: () => ({ sessionId, transcriptRevision: version }),
    switchSession(id) { sessionId = id; },
    updateRevision(v) { version = v; },
    ...overrides
  };
}

test("NT-01/02: K queries exact LSP symbol and creates ONLY an inline Pi overlay", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  const controller = createNativeTranscriptController(f);
  await controller.invoke("hover", f.snapshot);
  assert.equal(f.seen.lsp.length, 1);
  assert.deepEqual(f.seen.lsp[0].position, { line: 19, character: 12 });
  assert.equal(f.seen.lsp[0].kind, "hover");
  assert.equal(f.seen.overlay.length, 1);
  assert.equal(f.seen.overlay[0].overlay, true);
  assert.equal(f.seen.replaced, 0, "native Pi transcript cannot be replaced by /intel viewer");
  assert.deepEqual(f.seen.model, []);
  controller.dispose();
});

test("NT-04: gd opens real LSP definition, not the source snippet or a new code viewer", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.deepEqual(f.seen.lsp.map(x => x.kind), ["definition"]);
  assert.equal(f.seen.opened.length, 1);
  assert.deepEqual(f.seen.opened[0], {
    uri: "file:///project/src/math.ts", line: 10, character: 4
  });
  assert.equal(f.seen.replaced, 0);
  assert.equal(f.seen.model.length, 0);
  controller.dispose();
});

test("NT-04: multiple definition targets open a transient inline picker, not first result", async () => {
  const { createNativeTranscriptController } = await native();
  const locations = [
    { uri: "file:///project/src/one.ts",
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } } },
    { uri: "file:///project/src/two.ts",
      range: { start: { line: 3, character: 4 }, end: { line: 3, character: 5 } } }
  ];
  const f = fixture({
    lsp: { async query() { return locations; } }
  });
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.equal(f.seen.opened.length, 0, "must require choosing among multiple targets");
  assert.equal(f.seen.overlay.length, 1);
  assert.equal(f.seen.overlay[0].overlay, true);
  controller.dispose();
});

test("NT-07: stale query result from different session/revision cannot overlay or navigate", async () => {
  const { createNativeTranscriptController } = await native();
  let release;
  const f = fixture({
    lsp: { query: () => new Promise(resolve => { release = resolve; }) }
  });
  const controller = createNativeTranscriptController(f);
  const pending = controller.invoke("hover", f.snapshot);
  await new Promise(resolve => setImmediate(resolve));
  f.switchSession("s2"); f.updateRevision("rev:6");
  release({ contents: "STALE DOCS" });
  await pending;
  assert.equal(f.seen.overlay.length, 0);
  assert.equal(f.seen.opened.length, 0);
  controller.dispose();
});

test("NT-06: unmapped symbol produces a local status without LSP, model or alternate viewer", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture({ resolveSymbol: async () => null });
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.equal(f.seen.lsp.length, 0);
  assert.equal(f.seen.opened.length, 0);
  assert.equal(f.seen.replaced, 0);
  assert.equal(f.seen.model.length, 0);
  assert.match(f.seen.notifications.join(" "), /source|mapping|definition|symbol/i);
  controller.dispose();
});
test("Focus-P0: when user tabs to editor while LSP is pending, delayed hover never opens", async () => {
  const { createNativeTranscriptController }=await native();
  let release,focused=true;
  const f=fixture({lsp:{query:()=>new Promise(resolve=>{release=resolve;})}});
  const controller=createNativeTranscriptController(f);
  const pending=controller.invoke("hover",{...f.snapshot,isCurrent:()=>focused});
  await new Promise(resolve=>setImmediate(resolve));
  focused=false;
  release({contents:"outdated hover"});
  await pending;
  assert.equal(f.seen.overlay.length,0);
  controller.dispose();
});
test("Navigation-P0: source modification after definition result cannot trigger wrong-file Neovim jump", async () => {
  const {createNativeTranscriptController}=await native();
  const f=fixture();
  const controller=createNativeTranscriptController({...f,validateSource:async()=>false});
  await controller.invoke("definition",f.snapshot);
  assert.deepEqual(f.seen.opened,[]);
  assert.match(f.seen.notifications.join(" "),/Source changed/i);
  controller.dispose();
});
