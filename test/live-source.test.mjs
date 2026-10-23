import test from "node:test";
import assert from "node:assert/strict";
import {resolveLiveTranscriptSymbol} from "../src/native/live-source.ts";
import {mkdtemp,writeFile,rm,realpath,readFile} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

test("real Pi transcript code line with filename hint resolves symbol without /intel viewer",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"pi-transcript-intel-"));
 try {
   const relative="src/service.ts",file=path.join(root,relative);
   await import("node:fs/promises").then(fs=>fs.mkdir(path.dirname(file),{recursive:true}));
   const src="export function calculateTotal(x: number) {\n  return x + 1;\n}\nconst sum = calculateTotal(5);\n";
   await writeFile(file,src);
   const display="  const sum = calculateTotal(5);";
   const begin=display.indexOf("calculateTotal");
   const snapshot={itemSemanticKey:"msg:1",transcriptRevision:"r1",
     itemText:"NEW · src/service.ts\nThe server uses this: \n```ts\n"+src+"```",
     renderedLine:display,visualCursor:{row:15,col:begin+4}};
   const match=await resolveLiveTranscriptSymbol(snapshot,{root,readFile,realpath});
   assert.deepEqual(match?.position,{line:3,character:12});
   assert.equal(match?.token,"calculateTotal");
 }finally{await rm(root,{recursive:true,force:true});}
});
test("source mapping refuses fake file path, stale text and whitespace instead of guessing",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"pi-transcript-intel-"));
 try{
   await writeFile(path.join(root,"a.ts"),"const result = realSymbol();\n");
   const original={itemText:"a.ts",renderedLine:" const result = realSymbol();",
     visualCursor:{row:7,col:18},itemSemanticKey:"x",transcriptRevision:"1"};
   assert.equal((await resolveLiveTranscriptSymbol(original,{root,readFile,realpath}))?.token,"realSymbol");
   assert.equal(await resolveLiveTranscriptSymbol({...original,renderedLine:" const result = fakeSymbol();"},
       {root,readFile,realpath}),null);
   assert.equal(await resolveLiveTranscriptSymbol({...original,visualCursor:{row:7,col:6}},
       {root,readFile,realpath}),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
