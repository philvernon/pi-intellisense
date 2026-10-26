import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mapRenderedRegion,
  resolveTranscriptSymbol,
} from "../../src/native/transcript-source.ts";
import { transcriptSnapshot } from "../helpers.ts";
import type { SourceRegion } from "../../src/native/transcript-source.ts";

const text = 'const a = "界"; café;';
const contents = text + "\n",
  uri = "file:///work/repo/src/example.ts";
const fileHash = createHash("sha256").update(contents).digest("hex");

const snapshot = transcriptSnapshot({
  itemSemanticKey: "message:5",
  transcriptRevision: "r4",
  layoutRevision: "w80",
  renderedLines: ["heading", "    " + text],
  renderedStartRow: 34,
  visualCursor: { row: 35, col: 4 + text.indexOf("café") + 1 },
});
const regions = mapRenderedRegion(snapshot, {
  kind: "verified-file",
  origin: "structured-read",
  codeRegionId: "code:0",
  uri,
  fileHash,
  lines: [{ text, sourceLine: 8 }],
} satisfies SourceRegion);
const source = { readFile: async () => contents };

test("production mapper resolves exact UTF-16 position after wide glyph", async () => {
  const result = await resolveTranscriptSymbol({ snapshot, regions, source });
  assert.deepEqual(result!.position, {
    line: 8,
    character: text.indexOf("café"),
  });
  assert.equal(result!.token, "café");
  assert.ok(result?.kind === "verified-file");
  assert.equal(result.fileHash, fileHash);
});
test("production mapper rejects gutters, whitespace, punctuation and offscreen rows", async () => {
  for (const cursor of [
    { row: 35, col: 0 },
    { row: 35, col: 9 },
    { row: 35, col: 12 },
    { row: 36, col: 20 },
    { row: 35, col: 1000 },
  ])
    assert.equal(
      await resolveTranscriptSymbol({
        snapshot: { ...snapshot, visualCursor: cursor },
        regions,
        source,
      }),
      null,
    );
});
test("production mapper rejects stale transcript identity, reflow and source changes", async () => {
  for (const changes of [
    { itemSemanticKey: "other" },
    { transcriptRevision: "r5" },
    { layoutRevision: "w40" },
  ])
    assert.equal(
      await resolveTranscriptSymbol({
        snapshot: { ...snapshot, ...changes },
        regions,
        source,
      }),
      null,
    );
  assert.equal(
    await resolveTranscriptSymbol({
      snapshot,
      regions,
      source: { readFile: async () => "changed" },
    }),
    null,
  );
});
test("production mapper rejects duplicate source spans rather than selecting first", async () => {
  assert.equal(
    await resolveTranscriptSymbol({
      snapshot,
      regions: [...regions, ...regions],
      source,
    }),
    null,
  );
});
test("render map does not claim partial wrapped or truncated source lines", () => {
  assert.deepEqual(
    mapRenderedRegion(
      { ...snapshot, renderedLines: ["    " + text.slice(0, 10)] },
      {
        kind: "verified-file",
        uri,
        fileHash,
        lines: [{ text, sourceLine: 8 }],
      },
    ),
    [],
  );
});
