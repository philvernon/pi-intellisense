import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as nodeFs } from "node:fs";
export function normalizeLocations(response) {
  const values = response == null ? [] : Array.isArray(response) ? response : [response];
  const seen = new Set(), result=[];
  for (const item of values) {
    if (!item || typeof item !== "object") continue;
    const uri = item.targetUri ?? item.uri;
    const selectionRange = item.targetSelectionRange ?? item.range ?? item.targetRange;
    if (typeof uri !== "string" || !selectionRange?.start || !Number.isInteger(selectionRange.start.line) || !Number.isInteger(selectionRange.start.character)) continue;
    const key = [uri,selectionRange.start.line,selectionRange.start.character].join("|");
    if (seen.has(key)) continue; seen.add(key);
    result.push({ uri, range: item.targetRange ?? item.range ?? selectionRange, selectionRange });
  }
  return result;
}
export function within(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel);
}
/** @param {{root?:string,roots?:string[],fs?:typeof nodeFs}} options */
export async function validateFileLocation(location, options = {}) {
  const {root,roots,fs=nodeFs}=options;
  const uri = location?.uri ?? location?.targetUri;
  const start=(location?.selectionRange??location?.range??location?.targetSelectionRange)?.start;
  if(!Number.isSafeInteger(start?.line)||start.line<0||!Number.isSafeInteger(start?.character)||start.character<0)
    throw new RangeError("Invalid destination position");
  if (typeof uri !== "string" || !uri.startsWith("file://")) throw new TypeError("Only local file URI scheme allowed");
  let url;
  try { url = new URL(uri); }
  catch { throw new TypeError("Invalid local file URI"); }
  if (url.protocol !== "file:" || url.hostname && url.hostname !== "localhost") throw new TypeError("Unsupported URI scheme or host");
  const originalPath = fileURLToPath(url);
  const allowedRoots = roots ?? (root ? [root] : []);
  if (!allowedRoots.some(r => within(path.resolve(r), path.resolve(originalPath))))
    throw new Error("Destination outside trusted workspace root");
  const canonical = await fs.realpath(originalPath);
  if (!allowedRoots.some(r => within(path.resolve(r), canonical)))
    throw new Error("Destination realpath outside trusted workspace root");
  if(!(await fs.stat(canonical)).isFile())throw new TypeError("Destination is not a regular file");
  return {path:canonical,uri,line:start.line,character:start.character};
}
