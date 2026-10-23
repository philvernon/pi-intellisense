import path from "node:path";
import { promises as nodeFs } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { extractFencedBlocks } from "../blocks.mjs";
import { stripAnsi, terminalCells, visualToLspCharacter } from "../positions.mjs";
import { within } from "../locations.mjs";
import { resolveLiveTranscriptSymbol } from "./live-source.ts";

const LANGUAGES = new Map([
  ["ts","typescript"],["typescript","typescript"],["tsx","typescriptreact"],
  ["js","javascript"],["javascript","javascript"],["jsx","javascriptreact"],
  ["py","python"],["python","python"],["rs","rust"],["rust","rust"],
  ["go","go"],["lua","lua"]
]);
const identify = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const MAX_BYTES = 2_000_000;

export function symbolAtLine(displayed, line, cursorColumn, sourceStart=0) {
  const text=stripAnsi(displayed);
  const at=text.indexOf(line);
  if(at<0 || text.indexOf(line,at+1)>=0) return null;
  const visualStart=terminalCells(text.slice(0,at));
  const offset=visualToLspCharacter(line,cursorColumn-visualStart);
  if(offset===undefined)return null;
  for(const match of line.matchAll(identify)) {
    if(offset>=match.index && offset<match.index+match[0].length)
      return {token:match[0],character:sourceStart+match.index};
  }
  return null;
}

export function readFileReferences(entries=[]) {
  const calls=new Map();
  const records=[];
  for(const entry of entries) {
    const m=entry?.message;
    if(entry?.type!=="message"||!m)continue;
    if(m.role==="assistant" && Array.isArray(m.content)) {
      for(const part of m.content) {
        if(part?.type==="toolCall" && part.name==="read" &&
          typeof part.id==="string" && typeof part.arguments?.path==="string")
          calls.set(part.id,part.arguments.path);
      }
    }
    if(m.role==="toolResult" && m.toolName==="read" && !m.isError) {
      const candidate=calls.get(m.toolCallId);
      if(!candidate)continue;
      const content=typeof m.content==="string"?m.content:
        Array.isArray(m.content)?m.content.filter(x=>x?.type==="text").map(x=>x.text).join("\n"):"";
      if(content && content.length<=MAX_BYTES)
        records.push({candidate,content,entryId:String(entry.id??"")});
    }
  }
  return records;
}
function labeledTextLines(raw) {
  return raw.split(/\r?\n/u).map(x=>{
    const m=/^\s*(\d+)(?::|\s*[│|])\s?(.*)$/u.exec(x);
    return m?{text:m[2],line:Number(m[1])-1}:{text:x,line:null};
  });
}
async function safeFile(root,candidate,fs) {
  const proposed=path.resolve(root,candidate);
  if(!within(root,proposed))return null;
  const [realRoot,realFile]=await Promise.all([
    fs.realpath(root).catch(()=>path.resolve(root)),
    fs.realpath(proposed).catch(()=>null)
  ]);
  if(!realFile || !within(realRoot,realFile))return null;
  const contents=await fs.readFile(realFile,"utf8").catch(()=>null);
  return typeof contents==="string"&&contents.length<=MAX_BYTES?
    {file:realFile,contents}:null;
}
function verifiedLineIndex(originalLine,fileLines,claimedIndex) {
  if(Number.isInteger(claimedIndex))
    return fileLines[claimedIndex]===originalLine?claimedIndex:null;
  const indices=[];
  for(let i=0;i<fileLines.length;i++)if(fileLines[i]===originalLine)indices.push(i);
  return indices.length===1?indices[0]:null;
}
async function fromRead(snapshot,root,entries,fs){
  if(snapshot.itemKind!=="tool")return [];
  const display=stripAnsi(snapshot.renderedLine??"");
  const results=[];
  for(const record of readFileReferences(entries)) {
    const visible=String(snapshot.itemText??"");
    if(!visible || !record.content)continue;
    const candidate=await safeFile(root,record.candidate,fs);
    if(!candidate)continue;
    const lines=candidate.contents.split(/\r?\n/u);
    for(const row of labeledTextLines(record.content)) {
      if(row.text.trim().length<2 || !visible.includes(row.text))continue;
      const index=verifiedLineIndex(row.text,lines,row.line);
      if(index===null)continue;
      const target=symbolAtLine(display,row.text,snapshot.visualCursor.col);
      if(!target)continue;
      results.push({kind:"verified-file",uri:pathToFileURL(candidate.file).href,
        fileHash:createHash("sha256").update(candidate.contents).digest("hex"),
        position:{line:index,character:target.character},token:target.token,
        origin:"structured-read",sourceText:candidate.contents});
    }
  }
  return results;
}
function parseFences(snapshot) {
  const text=String(snapshot.itemText??"");
  if(!text.includes("\x60")&&!text.includes("~"))return [];
  return extractFencedBlocks(text,{messageId:snapshot.itemSemanticKey??"",origin:"transcript"});
}
function virtualResult(snapshot) {
  const display=stripAnsi(snapshot.renderedLine??"");
  const hits=[];
  for(const block of parseFences(snapshot)) {
    const languageId=LANGUAGES.get(block.language.toLowerCase());
    if(!languageId)continue;
    const sourceLines=block.code.split(/\r?\n/u);
    for(let i=0;i<sourceLines.length;i++){
      const sourceLine=sourceLines[i];
      if(!sourceLine.trim())continue;
      const target=symbolAtLine(display,sourceLine,snapshot.visualCursor.col);
      if(target)hits.push({kind:"virtual-document",
        uri:"untitled://pi-intellisense/"+encodeURIComponent(snapshot.sessionId??"")+"/"+encodeURIComponent(block.id),
        languageId,text:block.code,position:{line:i,character:target.character},
        token:target.token,origin:"fence",readOnly:true});
    }
  }
  return hits.length===1?hits[0]:null;
}
export async function resolveTranscriptProvenance(snapshot,{root,entries=[],fs=nodeFs,allowVirtual=true}={}){
  if(!snapshot?.visualCursor || !String(snapshot.renderedLine??"").trim())
    return {kind:"unmapped",reason:"cursor-not-symbol"};
  const read=await fromRead(snapshot,root,entries,fs);
  if(read.length===1)return read[0];
  if(read.length>1)return {kind:"unmapped",reason:"ambiguous"};
  const disk=await resolveLiveTranscriptSymbol(snapshot,{root,readFile:fs.readFile.bind(fs),realpath:fs.realpath.bind(fs)});
  if(disk)return {...disk,kind:"verified-file",origin:"verified-message"};
  const virtual=virtualResult(snapshot);
  if(virtual)return allowVirtual?virtual:{kind:"unmapped",reason:"virtual-document-unsupported"};
  return {kind:"unmapped",reason:"source-unknown"};
}
