import path from "node:path";
import { createHash } from "node:crypto";
import { promises as nodeFs } from "node:fs";
import { within } from "./locations.mjs";

export async function resolveSourceAnchor({ block, root, candidate, fs = nodeFs }) {
  const unmapped = { kind: "unmapped" };
  if (candidate?.kind !== "selected-file" || typeof candidate.path !== "string" || !root || !block?.code) return unmapped;
  const requested = path.resolve(root, candidate.path);
  if (!within(path.resolve(root), requested)) return unmapped;
  try {
    const actual = await fs.realpath(requested);
    if (!within(path.resolve(root),actual)) return unmapped;
    const full = await fs.readFile(actual, "utf8");
    const code = block.code.endsWith("\n") ? block.code.slice(0,-1) : block.code;
    if (!code) return unmapped;
    const positions = [];
    let at = 0;
    while ((at = full.indexOf(code, at)) !== -1) {
      if ((at === 0 || full[at - 1] === "\n") && (at + code.length === full.length || /[\r\n]/u.test(full[at+code.length]))) {
        const prefix = full.slice(0,at);
        positions.push({startLine:prefix.split("\n").length - 1,startCharacter:0});
      }
      at += code.length || 1;
    }
    if (positions.length > 1) return {kind:"ambiguous", matches:positions};
    if (positions.length !== 1) return unmapped;
    return {kind:"disk-verified",path:actual,uri:new URL("file://" + actual).href,...positions[0],
      text:full,code,sourceHash:createHash("sha256").update(full).digest("hex"),language:block.language,blockId:block.id};
  } catch { return unmapped; }
}
