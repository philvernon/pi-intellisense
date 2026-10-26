import path from "node:path";
import {promises as nodeFs} from "node:fs";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import {pathToFileURL,fileURLToPath} from "node:url";
import {extractFencedBlocks} from "../blocks.mjs";
import {within} from "../locations.mjs";
import {mapRenderedRegion,mapRenderedFence,resolveTranscriptSymbol} from "./transcript-source.ts";

const LANGUAGES=new Map([
  ["ts","typescript"],["typescript","typescript"],["tsx","typescriptreact"],
  ["js","javascript"],["javascript","javascript"],["jsx","javascriptreact"],
  ["py","python"],["python","python"],["rs","rust"],["rust","rust"],
  ["go","go"],["lua","lua"]
]);
const MAX_BYTES=2_000_000;
const hash=text=>createHash("sha256").update(text).digest("hex");
const unmapped=reason=>({kind:"unmapped",reason});
const linesOf=text=>text.replace(/\r\n/gu,"\n").replace(/\n$/u,"").split("\n");

export function readFileReferences(entries=[]){
  const calls=new Map(),records=[];
  for(const entry of entries){
    const message=entry?.message;
    if(entry?.type!=="message"||!message)continue;
    if(message.role==="assistant"&&Array.isArray(message.content)){
      for(const part of message.content)
        if(part?.type==="toolCall"&&part.name==="read"&&typeof part.id==="string"&&
          typeof part.arguments?.path==="string")calls.set(part.id,part.arguments);
    }
    if(message.role!=="toolResult"||message.toolName!=="read"||message.isError||message.details?.truncation?.truncated)continue;
    const args=calls.get(message.toolCallId);
    if(!args)continue;
    const content=typeof message.content==="string"?message.content:
      Array.isArray(message.content)?message.content.filter(x=>x?.type==="text").map(x=>x.text).join("\n"):"";
    if(content&&content.length<=MAX_BYTES)records.push({candidate:args.path,content,
      offset:args.offset??1,limit:args.limit,toolCallId:message.toolCallId});
  }
  return records;
}

function nativeReadPath(candidate){
  let value=candidate.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu," ");
  if(value.startsWith("@"))value=value.slice(1);
  if(value==="~")return homedir();
  if(value.startsWith("~/"))return path.join(homedir(),value.slice(2));
  if(value.startsWith("file://")){
    try{return fileURLToPath(value);}catch{return null;}
  }
  return value;
}
async function safeFile(root,candidate,fs){
  if(typeof candidate!=="string")return null;
  const proposed=path.resolve(root,candidate);
  const [realRoot,realFile]=await Promise.all([fs.realpath(root),fs.realpath(proposed)]).catch(()=>[]);
  if(!realRoot||!realFile||!within(realRoot,realFile))return null;
  const contents=await fs.readFile(realFile,"utf8").catch(()=>null);
  return typeof contents==="string"&&contents.length<=MAX_BYTES?
    {uri:pathToFileURL(realFile).href,sourceText:contents,fileHash:hash(contents)}:null;
}

function readLines(record,file){
  if(!Number.isSafeInteger(record.offset)||record.offset<1)return null;
  const disk=linesOf(file.sourceText);
  const rows=linesOf(record.content).map((text,i)=>({text,sourceLine:record.offset-1+i}));
  if((record.limit===undefined||Number.isSafeInteger(record.limit)&&record.limit>=rows.length)&&
    rows.every(row=>disk[row.sourceLine]===row.text))return rows;
  if(!Number.isSafeInteger(record.limit)||record.limit<1)return null;
  const allLines=file.sourceText.replace(/\r\n/gu,"\n").split("\n"),end=record.offset-1+record.limit;
  const selected=allLines.slice(record.offset-1,end).join("\n"),remaining=allLines.length-end;
  const expected=selected+`\n\n[${remaining} more lines in file. Use offset=${end+1} to continue.]`;
  if(remaining<=0||record.content.replace(/\r\n/gu,"\n")!==expected)return null;
  return linesOf(selected).map((text,i)=>({text,sourceLine:record.offset-1+i}));
}

function commonIndent(lines){
  const nonblank=lines.filter(line=>line.trim());
  let prefix=/^[\t ]*/u.exec(nonblank[0]??"")[0];
  for(const line of nonblank)while(!line.startsWith(prefix))prefix=prefix.slice(0,-1);
  return prefix;
}

function quotedRanges(quote,rows){
  const indent=commonIndent(quote),body=quote.map(line=>line.trim()?line.slice(indent.length):"");
  const first=body.findIndex(line=>line.trim());
  if(first<0)return [];
  const matches=[];
  for(let start=0;start+quote.length<=rows.length;start++){
    if(rows[start+first].text.trimStart()!==body[first].trimStart())continue;
    const window=rows.slice(start,start+quote.length),prefix=commonIndent(window.map(row=>row.text));
    if(window.some((row,i)=>(row.text.trim()?row.text.slice(prefix.length):"")!==body[i]))continue;
    matches.push({start,sourceLine:window[0].sourceLine,sourceCharacterStart:prefix.length-indent.length});
    if(matches.length===2)break;
  }
  return matches;
}

async function quotedReadSource(quote,{root,entries,fs}){
  const candidates=new Map(),files=new Map();
  for(const record of readFileReferences(entries)){
    if(!Number.isSafeInteger(record.offset)||record.offset<1||
      record.limit!==undefined&&(!Number.isSafeInteger(record.limit)||record.limit<1))continue;
    const rows=linesOf(record.content).slice(0,record.limit).map((text,i)=>({text,sourceLine:record.offset-1+i}));
    const matches=quotedRanges(quote,rows);
    if(!matches.length)continue;
    const candidate=nativeReadPath(record.candidate);
    if(candidate===null)continue;
    const proposed=path.resolve(root,candidate);
    if(!files.has(proposed))files.set(proposed,safeFile(root,candidate,fs));
    const file=await files.get(proposed),verified=file&&readLines(record,file);
    for(const match of matches){
      const key=JSON.stringify([file?.uri??proposed,match.sourceLine,match.sourceCharacterStart]);
      const valid=verified&&match.start+quote.length<=verified.length;
      if(!candidates.has(key)||valid)candidates.set(key,{...match,file,valid});
    }
  }
  if(candidates.size>1)return unmapped("ambiguous");
  const binding=candidates.values().next().value;
  if(!binding)return null;
  if(!binding.valid)return unmapped(binding.file?"stale-source":"source-unavailable");
  return binding;
}

/** @param {{root:string,entries?:unknown[],fs?:typeof nodeFs,allowVirtual?:boolean}} options */
export async function resolveTranscriptProvenance(snapshot,options){
  const {root,entries=[],fs=nodeFs,allowVirtual=true}=options;
  if(!snapshot?.visualCursor)return unmapped("cursor-not-symbol");
  const regions=[],files=new Map();
  if(snapshot.itemKind==="tool"){
    const records=readFileReferences(entries).filter(record=>record.toolCallId===snapshot.toolCallId);
    if(records.length!==1)return unmapped(records.length?"ambiguous":"source-unknown");
    const record=records[0],file=await safeFile(root,nativeReadPath(record.candidate),fs);
    if(!file)return unmapped("source-unknown");
    const lines=readLines(record,file);
    if(!lines)return unmapped("stale-source");
    files.set(file.uri,file.sourceText);
    regions.push(...mapRenderedRegion(snapshot,{...file,kind:"verified-file",
      codeRegionId:"read:"+record.toolCallId,origin:"structured-read",lines}));
  }else if(snapshot.itemKind==="message"){
    if(typeof snapshot.sourceText!=="string")return unmapped("source-unknown");
    const blocks=extractFencedBlocks(snapshot.sourceText,{messageId:snapshot.itemSemanticKey,origin:"assistant"});
    for(const block of blocks){
      const codeLines=linesOf(block.code);
      if(!block.code)continue;
      // Map before validating so a broken annotation elsewhere cannot disable this block.
      const placements=mapRenderedFence(snapshot,block,blocks);
      if(!placements.some(region=>region.displayLines.some(row=>row.displayRow===snapshot.visualCursor.row)))continue;
      if(block.sourceError)return unmapped(block.sourceError);
      if(block.sourceBinding){
        const binding=block.sourceBinding,file=await safeFile(root,binding.path,fs);
        if(!file)return unmapped("source-unavailable");
        const disk=linesOf(file.sourceText);
        if(binding.endLine-binding.startLine+1!==codeLines.length||
          codeLines.some((line,i)=>disk[binding.startLine+i]!==line))return unmapped("stale-source");
        files.set(file.uri,file.sourceText);
        regions.push(...placements.map(region=>({...region,...file,kind:"verified-file",origin:"annotated-fence",
          displayLines:region.displayLines.map(row=>({...row,sourceLine:row.sourceLine+binding.startLine}))})));
      }else{
        const binding=await quotedReadSource(codeLines,{root,entries,fs});
        if(binding&&binding.kind!=="unmapped"){
          files.set(binding.file.uri,binding.file.sourceText);
          const sourceRow=row=>({...row,sourceLine:row.sourceLine+binding.sourceLine,
            sourceCharacterStart:binding.sourceCharacterStart});
          regions.push(...placements.map(region=>({...region,...binding.file,kind:"verified-file",origin:"read-quote",
            lines:region.lines.map(sourceRow),displayLines:region.displayLines.map(sourceRow)})));
        }else{
          const languageId=LANGUAGES.get(block.language.toLowerCase());
          if(!languageId)continue;
          if(!allowVirtual)return unmapped("virtual-document-unsupported");
          regions.push(...placements.map(region=>({...region,kind:"virtual-document",languageId,
            uri:"untitled://pi-intellisense/"+encodeURIComponent(snapshot.sessionId)+"/"+encodeURIComponent(block.id),
            text:block.code,readOnly:true,origin:"fence"})));
        }
      }
    }
  }else return unmapped("source-unknown");
  const hits=regions.filter(region=>region.displayLines.some(row=>row.displayRow===snapshot.visualCursor.row));
  if(hits.length>1)return unmapped("ambiguous");
  if(!hits.length)return unmapped("wrapped-unmappable");
  const anchor=await resolveTranscriptSymbol({snapshot,regions:hits,
    source:{readFile:async uri=>files.get(uri)??fs.readFile(fileURLToPath(uri),"utf8")}});
  return anchor??unmapped("cursor-not-symbol");
}
