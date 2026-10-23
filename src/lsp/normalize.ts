import { normalizeLocations as full } from "../locations.mjs";
export function normalizeLocations(input:any) {
  return full(input).map(x=>({uri:x.uri,line:x.selectionRange.start.line,
    character:x.selectionRange.start.character}));
}
export function normalizeHover(input:any):{markdown:string}|null {
  if(!input?.contents)return null;
  const parts=Array.isArray(input.contents)?input.contents:[input.contents];
  const markdown=parts.map(x=>typeof x==="string"?x:typeof x?.value==="string"?x.value:"").join("\n\n")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu,"")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu,"");
  return markdown?{markdown}:null;
}