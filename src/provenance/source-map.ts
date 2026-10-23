export function resolveSourceAtCursor({spans,cursor,expectedRevision,currentRevision}:{
  spans:Array<any>;cursor:{row:number;col:number};expectedRevision?:string;currentRevision?:string;
}) {
  if(expectedRevision!==undefined&&currentRevision!==expectedRevision)return null;
  const matches=spans.filter(x=>x.displayRow===cursor.row&&cursor.col>=x.displayColStart&&cursor.col<x.displayColEnd);
  return matches.length===1?matches[0].anchor:null;
}