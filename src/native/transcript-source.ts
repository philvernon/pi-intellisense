import {createHash} from "node:crypto";
import {visualToLspCharacter} from "../positions.mjs";
export async function resolveTranscriptSymbol({snapshot,regions,source}:any){
 if(!snapshot?.visualCursor||!snapshot.selectedCodeRegionId)return null;
 const matches=regions.filter((r:any)=>r.codeRegionId===snapshot.selectedCodeRegionId&&
   r.itemSemanticKey===snapshot.itemSemanticKey&&r.transcriptRevision===snapshot.transcriptRevision&&
   r.layoutRevision===snapshot.layoutRevision&&r.origin!=="assistant-hint"&&typeof r.fileHash==="string"&&
   r.displayLines?.some((line:any)=>line.displayRow===snapshot.visualCursor.row&&
     snapshot.visualCursor.col>=line.displayColStart));
 if(matches.length!==1)return null;
 const region=matches[0],line=region.displayLines.find((x:any)=>x.displayRow===snapshot.visualCursor.row);
 const sourceText=await source.readFile(region.fileUri).catch(()=>null);
 if(typeof sourceText!=="string"||createHash("sha256").update(sourceText).digest("hex")!==region.fileHash)return null;
 const relative=snapshot.visualCursor.col-line.displayColStart;
 const column=visualToLspCharacter(line.text,relative,{tabSize:4});
 if(column===undefined)return null;
 const rx=/[\p{L}\p{N}_$]+/gu;
 for(const item of line.text.matchAll(rx)){
   if(column>=item.index&&column<item.index+item[0].length)
     return {uri:region.fileUri,position:{line:line.sourceLine,character:line.sourceCharacterStart+item.index},
       fileHash:region.fileHash,token:item[0],confidence:"verified"};
 }
 return null;
}
export function createVirtualCodeDocument({sessionId,codeRegionId,code,languageId}:any){
 const key=encodeURIComponent(sessionId)+"/"+encodeURIComponent(codeRegionId);
 return {uri:"untitled://pi-intellisense/"+key,languageId,content:code,
  virtual:true,readOnly:true,canNavigateWithoutVerifiedTarget:false};
}
