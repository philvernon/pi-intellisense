import test from "node:test";
import assert from "node:assert/strict";
import {execFile as callback} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,writeFile,readFile,realpath,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";
import {createLspManager} from "../../src/runtime.mjs";
import {resolveTranscriptProvenance} from "../../src/native/provenance-resolver.mjs";

const execFile=promisify(callback);
const root=fileURLToPath(new URL("../..",import.meta.url));

test("real TypeScript LSP resolves annotated transcript code and unsaved generated code",async()=>{
 const runtime=createLspManager({cwd:root});
 try{
   const relative="test/fixtures/source.ts",text=await readFile(path.join(root,relative),"utf8");
   const renderedLines=text.trimEnd().split("\n").map(line=>"  "+line);
   const snapshot={sessionId:"live-smoke",itemKind:"message",itemSemanticKey:"m1",transcriptRevision:"r1",layoutRevision:"w120",
     sourceText:'```ts source="'+relative+'" lines="1-5"\n'+text+'```',
     renderedLines:["```ts",...renderedLines,"```"],renderedStartRow:0,visualCursor:{row:5,col:3}};
   const source=await resolveTranscriptProvenance(snapshot,{root});
   assert.equal(source.kind,"verified-file");
   const client=await runtime.get(path.join(root,relative),text);
   const hover=await client.query({kind:"hover",uri:source.uri,position:source.position});
   assert.match(JSON.stringify(hover),/greet|function/);
   const definition=await client.query({kind:"definition",uri:source.uri,position:source.position});
   assert.match(JSON.stringify(definition),/source\.ts/);
   const virtualCode="function double(value: number) { return value * 2; }\ndouble(2);\n";
   const virtualFile=path.join(root,".pi-intellisense-virtual","runtime-smoke.ts");
   const virtual=await runtime.get(virtualFile,virtualCode);
   const result=await virtual.query({kind:"hover",uri:new URL("file://"+virtualFile).href,position:{line:1,character:1}});
   assert.match(JSON.stringify(result),/double.*number/);
 }finally{await runtime.close();}
});

test("real TypeScript LSP recovers imported method context from an unannotated read quote",async()=>{
 const directory=await realpath(await mkdtemp(path.join(tmpdir(),"pi-read-quote-")));
 const runtime=createLspManager({cwd:directory});
 try{
   await symlink(path.join(root,"node_modules"),path.join(directory,"node_modules"),"dir");
   const implementation=path.join(directory,"greeter.ts"),file=path.join(directory,"usage.ts");
   const code='import {Greeter} from "./greeter.js";\n\nconst greeter = new Greeter();\nfunction run() {\n    greeter.describe();\n}\n';
   await writeFile(path.join(directory,"tsconfig.json"),JSON.stringify({compilerOptions:{strict:true,module:"NodeNext",moduleResolution:"NodeNext"},include:["*.ts"]}));
   await writeFile(implementation,'export class Greeter {\n  describe(): string { return "hello"; }\n}\n');
   await writeFile(file,code);
   const entries=[
     {type:"message",message:{role:"assistant",content:[{type:"toolCall",id:"read-context",name:"read",arguments:{path:"usage.ts"}}]}},
     {type:"message",message:{role:"toolResult",toolCallId:"read-context",toolName:"read",content:[{type:"text",text:code}],isError:false}}
   ];
   const snapshot={sessionId:"read-quote",itemKind:"message",itemSemanticKey:"quote",transcriptRevision:"r1",layoutRevision:"w120",
     sourceText:"```ts\n  greeter.describe();\n```",renderedLines:["```ts","    greeter.describe();","```"],
     renderedStartRow:0,visualCursor:{row:1,col:13}};
   const source=await resolveTranscriptProvenance(snapshot,{root:directory,entries});
   assert.equal(source.kind,"verified-file");
   assert.equal(source.origin,"read-quote");
   assert.equal(source.uri,pathToFileURL(file).href);
   assert.deepEqual(source.position,{line:4,character:12});
   const client=await runtime.get(file,code);
   let hover;
   for(let i=0;i<100;i++){
     hover=await client.query({kind:"hover",uri:source.uri,position:source.position});
     if(/Greeter\.describe\(\): string/u.test(JSON.stringify(hover)))break;
     await delay(50);
   }
   assert.match(JSON.stringify(hover),/Greeter\.describe\(\): string/);
   assert.doesNotMatch(JSON.stringify(hover),/\bany\b/);
   const definition=await client.query({kind:"definition",uri:source.uri,position:source.position});
   const locations=Array.isArray(definition)?definition:[definition];
   assert.ok(locations.some(location=>(location?.uri??location?.targetUri)===pathToFileURL(implementation).href&&
     (location.range??location.targetSelectionRange).start.line===1),"definition must target the imported class implementation");
 }finally{
   await runtime.close();
   await rm(directory,{recursive:true,force:true});
 }
});

test("real tmux gd launch opens visible Neovim lazily and reuses the same editor",async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),"pi-runtime-"));
 const server="pi-intel-test-"+process.pid+"-"+Date.now();
 const resultFile=path.join(directory,"result.json"),sourceFile=path.join(directory,"source | ; $(not-a-command).ts");
 let socket;
 try{
   await writeFile(sourceFile,'const café = "😃";\nconst value = café;\n');
   await execFile("tmux",["-L",server,"-f","/dev/null","new-session","-d","-s","smoke","-x","120","-y","40","-c",root,
     process.execPath,fileURLToPath(new URL("../fixtures/nvim-smoke.mjs",import.meta.url)),resultFile,sourceFile]);
   let result;
   for(let i=0;i<200;i++){
     const data=await readFile(resultFile,"utf8").catch(()=>null);
     if(data){result=JSON.parse(data);break;}
     await delay(50);
   }
   assert.ok(result,"tmux fixture must finish within 10 seconds");
   socket=result.socket;
   assert.equal(result.error,undefined,result.error);
   assert.equal(result.launches,1);
   assert.deepEqual(result.firstCursor,[2,19]);
   assert.deepEqual(result.cursor,[1,6]);
   assert.equal(result.file,await import("node:fs/promises").then(fs=>fs.realpath(sourceFile)));
   const panes=await execFile("tmux",["-L",server,"list-panes","-a","-F","#{pane_current_command}"]);
   assert.match(panes.stdout,/nvim/);
 }finally{
   await execFile("tmux",["-L",server,"kill-server"]).catch(()=>{});
   if(socket)await rm(path.dirname(socket),{recursive:true,force:true});
   await rm(directory,{recursive:true,force:true});
 }
});
