import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {resolveTranscriptProvenance,readFileReferences,symbolAtLine} from "../src/native/provenance-resolver.mjs";

test("Provenance: source from structured read tool call, with no filename in rendered text",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"pi-prov-"));
 try{
  await mkdir(path.join(root,"src"));
  await writeFile(path.join(root,"src","a.ts"),"export const state = 12;\nconsole.log(state);\n");
  const entries=[
    {type:"message",message:{role:"assistant",content:[
      {type:"toolCall",id:"r01",name:"read",arguments:{path:"src/a.ts"}}]}},
    {type:"message",id:"result",message:{role:"toolResult",toolName:"read",
      toolCallId:"r01",content:[{type:"text",text:"1: export const state = 12;\n2: console.log(state);"}]}}
  ];
  assert.equal(readFileReferences(entries).length,1);
  const line="2: console.log(state);";
  const snapshot={sessionId:"s1",itemKind:"tool",itemSemanticKey:"read:result",itemText:"1: export const state = 12;\n"+line,
    renderedLine:"  "+line,visualCursor:{row:21,col:line.indexOf("state")+3}};
  // rendered position includes 2 extra leading cells
  snapshot.visualCursor.col+=2;
  const result=await resolveTranscriptProvenance(snapshot,{root,entries});
  assert.equal(result.kind,"verified-file");
  assert.equal(result.token,"state");
  assert.deepEqual(result.position,{line:1,character:12});
  assert.equal(result.origin,"structured-read");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Provenance: numbered read result that disagrees with disk is not navigable",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"pi-prov-"));
 try{
  await writeFile(path.join(root,"a.ts"),"let correct = 1;\n");
  const entries=[
    {type:"message",message:{role:"assistant",content:[{type:"toolCall",id:"r2",name:"read",arguments:{path:"a.ts"}}]}},
    {type:"message",message:{role:"toolResult",toolName:"read",toolCallId:"r2",content:[{type:"text",text:"1: let wrong = 1;"}]}}
  ];
  const result=await resolveTranscriptProvenance({
    sessionId:"s",itemKind:"tool",itemText:"1: let wrong = 1;",renderedLine:"  1: let wrong = 1;",
    visualCursor:{row:11,col:11}
  },{root,entries});
  assert.equal(result.kind,"unmapped");
  assert.equal(result.reason,"source-unknown");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Provenance: generated fenced source becomes read-only virtual LSP document",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"pi-prov-"));
 try{
  const text="Here is a snippet:\n\x60\x60\x60ts\nconst price = 42;\nconsole.log(price);\n\x60\x60\x60";
  const renderedLine=" console.log(price);";
  const result=await resolveTranscriptProvenance({sessionId:"s",itemKind:"message",itemSemanticKey:"m1",
    itemText:text,renderedLine,visualCursor:{row:12,col:renderedLine.indexOf("price")+2}}, {root});
  assert.equal(result.kind,"virtual-document");
  assert.equal(result.languageId,"typescript");
  assert.equal(result.readOnly,true);
  assert.deepEqual(result.position,{line:1,character:12});
  const unsupported=await resolveTranscriptProvenance({sessionId:"s",itemKind:"message",itemSemanticKey:"m1",
    itemText:text,renderedLine,visualCursor:{row:12,col:renderedLine.indexOf("price")+2}}, {root,allowVirtual:false});
  assert.equal(unsupported.reason,"virtual-document-unsupported");
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Provenance: terminal-wide Unicode before symbol keeps exact UTF-16 position",()=>{
 const line='const c = "界"; café();';
 const displayed="  "+line;
 const col=2+line.indexOf("café")+2;
 const result=symbolAtLine(displayed,line,col+1);
 assert.deepEqual(result,{token:"café",character:line.indexOf("café")});
});
