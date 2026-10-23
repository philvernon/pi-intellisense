import { createHash } from "node:crypto";
function id(parts) { return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 18); }
/** Parse finalized CommonMark fenced blocks without treating info-string paths as trusted. */
export function extractFencedBlocks(markdown, { messageId = "", origin = "assistant" } = {}) {
  if (typeof markdown !== "string" || markdown.length > 250_000) return [];
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/gu) ?? [];
  const blocks = [];
  let open = null, body = "";
  for (const line of lines) {
    const withoutNewline = line.endsWith("\n") ? line.slice(0, -1).replace(/\r$/u, "") : line;
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/u.exec(withoutNewline);
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { marker:m[1][0], count:m[1].length,
          language:m[2].trim().split(/\s+/u)[0] || "", blockIndex:blocks.length };
        body = "";
      }
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u.exec(withoutNewline);
      if (close && close[1][0] === open.marker && close[1].length >= open.count) {
        const data = { id:id([messageId,open.blockIndex,body]), messageId, origin,
          language:open.language, code:body, blockIndex:open.blockIndex };
        blocks.push(data); open = null; body = "";
      } else body += line;
    }
  }
  return blocks;
}
