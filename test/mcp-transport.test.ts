import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { normalizeLocations } from "../src/locations.ts";
import { createProvider } from "../src/providers/index.ts";

const fixture = fileURLToPath(
  new URL("./fixtures/pi-lens-mcp.ts", import.meta.url),
);

test("Pi-lens MCP adapter: real child process handshake, hover and definition without model tools", async () => {
  const provider = createProvider({
    kind: "pi-lens-mcp",
    cwd: process.cwd(),
    piLensServer: fixture,
  });
  try {
    const uri = pathToFileURL("/tmp/a.ts").href;
    const h = await provider.query({
      kind: "hover",
      uri,
      position: { line: 0, character: 1 },
    });
    assert.deepEqual(h, { contents: "function f(): string" });
    const d = normalizeLocations(
      await provider.query({
        kind: "definition",
        uri,
        position: { line: 2, character: 3 },
      }),
    );
    assert.equal(d.length, 1);
    assert.equal(d[0].selectionRange.start.line, 3);
    assert.equal(d[0].uri, uri);
  } finally {
    await provider.close();
  }
});
