const ESCAPE = String.fromCharCode(27);
export const Key={escape:"escape",enter:"enter",up:"up",down:"down",left:"left",right:"right"};
const sequences={
  escape:["\x1b","\x1b[27u","\x1b[27;1u"],
  enter:["\r","\n","\x1b[13u","\x1b[13;1u"],
  up:["\x1b[A","\x1bOA","\x1b[1;1A"],
  down:["\x1b[B","\x1bOB","\x1b[1;1B"],
  left:["\x1b[D","\x1bOD","\x1b[1;1D"],
  right:["\x1b[C","\x1bOC","\x1b[1;1C"],
  "ctrl+k":["\x0b","\x1b[107;5u","\x1b[75;5u"],
  "ctrl+space":["\x00","\x1b[32;5u","\x1b[0;5u"]
};
export function matchesKey(input,key) {
  return sequences[key]?.includes(input)??input===key;
}
// This fallback avoids requiring a separately installed pi-tui package when using pi -e.
// Only width-aware clipping and the keys needed by this read-only view are implemented.
const GRAPHEMES=new Intl.Segmenter(undefined,{granularity:"grapheme"});
function cellWidth(g) {
  if(!g||/^\p{Mark}+$/u.test(g))return 0;
  const cp=g.codePointAt(0);
  if(/\p{Extended_Pictographic}/u.test(g) ||
    cp>=0x1100&&(cp<=0x115f||cp>=0x2329&&cp<=0x232a||
      cp>=0x2e80&&cp<=0xa4cf||cp>=0xac00&&cp<=0xd7a3||
      cp>=0xf900&&cp<=0xfaff||cp>=0xfe10&&cp<=0xfe19||
      cp>=0xfe30&&cp<=0xfe6f||cp>=0xff00&&cp<=0xff60||
      cp>=0xffe0&&cp<=0xffe6||cp>=0x1f000))return 2;
  return 1;
}
export function truncateToWidth(input,width){
  if(!Number.isFinite(width)||width<=0)return "";
  const pattern=/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu;
  const string=String(input);let cursor=0,used=0,out="",trimmed=false;
  function addText(text){
    for(const {segment} of GRAPHEMES.segment(text)){
      const n=cellWidth(segment);
      if(used+n>width){trimmed=true;return false;}
      out+=segment;used+=n;
    }
    return true;
  }
  let match;
  while((match=pattern.exec(string))){
    if(!addText(string.slice(cursor,match.index)))break;
    out+=match[0];cursor=pattern.lastIndex;
  }
  if(!trimmed)addText(string.slice(cursor));
  return out+(trimmed?"\x1b[0m":"");
}
