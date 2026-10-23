import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

/** NT-06, NT-08: DISPLAY CELL != LSP CHARACTER, no fabricated source. */
async function source() { return import("../../src/native/transcript-source.ts"); }
const line = 'const a = "界"; café;';
const fileText = line + "\n";
const hash = createHash("sha256").update(fileText).digest("hex");
const uri = "file:///work/repo/src/example.ts";
const region = {
  codeRegionId: "fence:0",
  itemSemanticKey: "message:5",
  fileUri: uri, origin: "verified-fence", fileHash: hash,
  displayLines: [{ displayRow: 35, displayColStart: 4, text: line,
    sourceLine: 8, sourceCharacterStart: 0 }],
  transcriptRevision: "transcript-v4",
  layoutRevision: "layout-v10"
};
function snapshot(col, changes = {}) {
  return {
    version: 1, sessionId: "session-1",
    itemSemanticKey: "message:5",
    selectedCodeRegionId: "fence:0",
    transcriptRevision: "transcript-v4", layoutRevision: "layout-v10",
    visualCursor: { row: 35, col },
    screenCursor: { row: 8, col }, ...changes
  };
}
const fileSource = { readFile: async name => {
  assert.equal(name, uri);
  return fileText;
} };

test("NT-06: exact symbol under cursor, after East Asian wide glyph, maps to UTF-16 source offset", async () => {
  const { resolveTranscriptSymbol } = await source();
  // rendered starts at col 4; the '界' contributes 2 terminal cells but 1 UTF-16 unit
  const expected = line.lastIndexOf("café");
  const displayColumn = 4 + expected + 1;
  const result = await resolveTranscriptSymbol({
    snapshot: snapshot(displayColumn), regions: [region], source: fileSource
  });
  assert.equal(result?.uri, uri);
  assert.deepEqual(result?.position, { line: 8, character: expected });
  assert.equal(result?.token, "café");
  assert.equal(result?.fileHash, hash);
});

test("NT-06: rejects line gutters, whitespace, punctuation and cursor outside code regions", async () => {
  const { resolveTranscriptSymbol } = await source();
  for(const col of [0, 4 + 5, 4 + line.indexOf("="), 1000]) {
    assert.equal(await resolveTranscriptSymbol({
      snapshot: snapshot(col), regions: [region], source: fileSource
    }), null, "must not snap to some other token when cursor is not on a symbol");
  }
  assert.equal(await resolveTranscriptSymbol({
    snapshot: snapshot(10, { selectedCodeRegionId: "some-other-fence" }),
    regions: [region], source: fileSource
  }), null);
});

test("NT-06: reject stale transcript revision, reflow or modified file before requesting LSP", async () => {
  const { resolveTranscriptSymbol } = await source();
  const changes = [
    { transcriptRevision: "new-message" },
    { layoutRevision: "terminal-resize" },
    { itemSemanticKey: "different-message" }
  ];
  for(const change of changes) {
    assert.equal(await resolveTranscriptSymbol({
      snapshot: snapshot(11, change), regions: [region], source: fileSource
    }), null);
  }
  const staleSource = { readFile: async () => fileText.replace("café", "unknown") };
  assert.equal(await resolveTranscriptSymbol({
    snapshot: snapshot(11), regions: [region], source: staleSource
  }), null, "wrong file hash must not be treated as a verified match");
});

test("NT-06: duplicate or unverifiable source spans decline navigation rather than choosing first", async () => {
  const { resolveTranscriptSymbol } = await source();
  const valid = await resolveTranscriptSymbol({
    snapshot: snapshot(11), regions: [region, { ...region, fileUri: "file:///work/repo/duplicate.ts" }],
    source: fileSource
  });
  assert.equal(valid, null);
  assert.equal(await resolveTranscriptSymbol({
    snapshot: snapshot(11), regions: [{ ...region, origin: "assistant-hint", fileHash: null }],
    source: fileSource
  }), null);
});

test("NT-08: unbacked generated code can be a read-only virtual LSP document, never a guessed file", async () => {
  const { createVirtualCodeDocument } = await source();
  const doc = createVirtualCodeDocument({
    sessionId: "session-1", codeRegionId: "assistant:0",
    code: "function plus(a: number,b: number){return a+b;}", languageId: "typescript"
  });
  assert.equal(doc.languageId, "typescript");
  assert.equal(doc.virtual, true);
  assert.equal(doc.readOnly, true);
  assert.ok(!doc.canNavigateWithoutVerifiedTarget);
  assert.notEqual(doc.uri, uri);
});
