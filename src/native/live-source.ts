import path from "node:path";
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {stripAnsi,visualToLspCharacter} from "../positions.mjs";
import {within} from "../locations.mjs";
const EXT=/\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|lua)$/iu;
export function candidates(text) {
 const found=new Set();
 for(const match of String(text).matchAll(/(?:^|[\s(`"'·])([\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|lua))(?![\w.])/gmu))found.add(match[1]);
 for(const match of String(text).matchAll(/github\.com\/[^\/\s)]+\/[^\/\s)]+\/blob\/[^\/\s)]+\/([^\s)]+\.(?:tsx?|jsx?|mjs|cjs|py|rs|go|lua))/gmu))found.add(match[1]);
 return [...found].filter(x=>!x.includes("..")&&x.length<260).slice(0,24);
}
/** Strictly match the exact displayed line of a source file: no guessed symbol search. */
export async function resolveLiveTranscriptSymbol(snapshot,{root,readFile=fs.readFile,realpath=fs.realpath}:any) {
 const cursor=snapshot?.visualCursor,displayed=stripAnsi(snapshot?.renderedLine??"");
 if(!cursor||!displayed.trim()||!snapshot?.itemText)return null;
 const canonicalRoot=await realpath(root).catch(()=>path.resolve(root));
 const paths=candidates(snapshot.itemText);
 if(snapshot.sourcePathHint)paths.unshift(snapshot.sourcePathHint);
 const results=[];
 const visited=new Set();
 for(const raw of paths){
   let file=path.resolve(root,raw);
   if(!within(root,file))continue;
   try{file=await realpath(file);}catch{continue;}
   if(!within(canonicalRoot,file)||visited.has(file))continue;
   visited.add(file);
   let source;
   try{source=await readFile(file,"utf8");}catch{continue;}
   if(typeof source!=="string"||source.length>2_000_000)continue;
   const sourceLines=source.split(/\r?\n/u);
   for(let i=0;i<sourceLines.length;i++){
     const line=sourceLines[i];if(line.trim().length<5)continue;
     // Only accept a complete source line represented literally in the rendered line.
     const offset=displayed.indexOf(line);
     if(offset<0||displayed.indexOf(line,offset+1)>=0)continue;
     const before=displayed.slice(0,offset);
     const startCol=[...before].length;
     const relative=cursor.col-startCol;
     if(relative<0)continue;
     const utf16=visualToLspCharacter(line,relative);
     if(utf16===undefined)continue;
     for(const m of line.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)){
       if(utf16>=m.index&&utf16<m.index+m[0].length)results.push({
         uri:pathToFileURL(file).href,filePath:file,position:{line:i,character:m.index},token:m[0],
         fileHash:createHash("sha256").update(source).digest("hex"),confidence:"verified",
         itemSemanticKey:snapshot.itemSemanticKey,transcriptRevision:snapshot.transcriptRevision
       });
     }
   }
 }
 // Duplicate matches have no authoritative provenance.
 return results.length===1?results[0]:null;
}