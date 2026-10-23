import { pathToFileURL } from "node:url";
export function mapReadResult({path,readText,fileText,itemSemanticKey,renderedStartRow}:{
  path:string;readText:string;fileText:string;itemSemanticKey:string;renderedStartRow:number;
}) {
  const rows=readText.split("\n"),lines=fileText.split("\n"),spans:any[]=[];
  for(let i=0;i<rows.length;i++){
    const m=/^\s*(\d+):\s?(.*)$/u.exec(rows[i]);
    if(!m)return null;
    const line=Number(m[1])-1;
    if(line<0||lines[line]!==m[2])return null;
    const prefixLength=rows[i].length-m[2].length;
    spans.push({itemSemanticKey,displayRow:renderedStartRow+i,
      displayColStart:prefixLength,displayColEnd:prefixLength+m[2].length,
      anchor:{sourceUri:pathToFileURL(path).href,
        sourceStart:{line,character:0},sourceEnd:{line,character:m[2].length},
        origin:"read-tool",confidence:"verified"}});
  }
  return {spans};
}