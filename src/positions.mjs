import { Buffer } from "node:buffer";

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

export function lspToNvimByteColumn(line, character, encoding = "utf-16") {
  if (!Number.isSafeInteger(character) || character < 0) throw new RangeError("invalid LSP character position");
  if (encoding === "utf-8") {
    const bytes = Buffer.from(line, "utf8");
    if (character > bytes.length) throw new RangeError("character position out of range");
    if (character < bytes.length && (bytes[character] & 0xc0) === 0x80)
      throw new RangeError("invalid UTF-8 boundary");
    return character;
  }
  if (encoding === "utf-32") {
    const points = Array.from(line);
    if (character > points.length) throw new RangeError("position out of range");
    return Buffer.byteLength(points.slice(0, character).join(""), "utf8");
  }
  if (encoding !== "utf-16") throw new TypeError("unsupported LSP position encoding");
  if (character > line.length) throw new RangeError("position out of range");
  const prev = line.charCodeAt(character - 1);
  const next = line.charCodeAt(character);
  if (character > 0 && character < line.length && prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
    throw new RangeError("position splits UTF-16 surrogate pair");
  return Buffer.byteLength(line.slice(0, character), "utf8");
}

export function stripAnsi(input) {
  return input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "");
}

function glyphWidth(text) {
  if (!text || /^\p{Mark}+$/u.test(text)) return 0;
  const cp = text.codePointAt(0);
  if (/\p{Extended_Pictographic}/u.test(text) || cp >= 0x1100 && (
    cp <= 0x115f || cp >= 0x2329 && cp <= 0x232a ||
    cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7a3 ||
    cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe19 ||
    cp >= 0xfe30 && cp <= 0xfe6f || cp >= 0xff00 && cp <= 0xff60 ||
    cp >= 0xffe0 && cp <= 0xffe6 || cp >= 0x1f000))
    return 2;
  return 1;
}
export function visualToLspCharacter(line, displayCol, { tabSize = 4 } = {}) {
  if (!Number.isInteger(displayCol) || displayCol < 0) return undefined;
  const source = stripAnsi(line);
  let col = 0, utf16 = 0;
  for (const { segment } of segmenter.segment(source)) {
    if (displayCol <= col) return utf16;
    const width = segment === "\t" ? tabSize - (col % tabSize) : glyphWidth(segment);
    if (displayCol < col + width) return utf16;
    col += width; utf16 += segment.length;
  }
  return displayCol <= col ? utf16 : undefined;
}
export const displayColumnToUtf16 = visualToLspCharacter;
/** Terminal display-cell width, used to map prefixes in styled transcript lines. */
export function terminalCells(text, {tabSize=4}={}) {
  let col=0;
  for (const {segment} of segmenter.segment(stripAnsi(text))) {
    const width=segment==="\t"?tabSize-(col%tabSize):glyphWidth(segment);
    col+=width;
  }
  return col;
}
