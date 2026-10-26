import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import piIntelliSense from "../src/index.ts";
import {stripAnsi} from "../src/positions.mjs";

function harness(root){
 const listeners=new Map(),subscriptions=new Map(),events=[],commands=[],transformers=[];
 const pi={
   registerCommand(name){commands.push(name);},
   registerMarkdownTransformer(transform){transformers.push(transform);},
   on(name,fn){listeners.set(name,fn);},
   events:{
     on(name,fn){const set=subscriptions.get(name)??new Set();set.add(fn);subscriptions.set(name,set);return ()=>set.delete(fn);},
     emit(name,payload){events.push({name,payload});for(const fn of subscriptions.get(name)??[])fn(payload);}
   }
 };
 const notices=[],overlays=[];
 const ctx={cwd:root,mode:"tui",sessionManager:{getSessionId:()=>"test-session",getBranch:()=>[]},
   ui:{notify(message){notices.push(message);},custom(factory,options){
     return new Promise(resolve=>{
       const component=factory({requestRender(){}},{fg:(_color,value)=>value},{},resolve);
       overlays.push({options,text:stripAnsi(component.render(80).join("\n"))});
       component.handleInput("\x1b");
     });
   }}
 };
 piIntelliSense(pi);
 return {pi,ctx,listeners,events,commands,transformers,notices,overlays,
   start:()=>listeners.get("session_start")({},ctx),
   shutdown:()=>listeners.get("session_shutdown")(),
   registration:()=>events.filter(event=>event.name==="pi-intellisense:register:v1").at(-1).payload};
}
async function workspace(fn){
 const root=await mkdtemp(path.join(tmpdir(),"pi-entry-")),agentDirectory=process.env.PI_CODING_AGENT_DIR;
 try{
   process.env.PI_CODING_AGENT_DIR=path.join(root,".pi/agent");
   await mkdir(path.join(root,".pi/agent"),{recursive:true});
   await writeFile(path.join(root,"a.ts"),"export const state = 12;\nconsole.log(state);\n");
   await writeFile(path.join(root,".pi/agent/pi-intellisense.json"),JSON.stringify({servers:{typescript:{
     command:process.execPath,args:[fileURLToPath(new URL("./fixtures/lsp-server.mjs",import.meta.url))]
   }}}));
   await fn(root);
 }finally{
   if(agentDirectory===undefined)delete process.env.PI_CODING_AGENT_DIR;
   else process.env.PI_CODING_AGENT_DIR=agentDirectory;
   await rm(root,{recursive:true,force:true});
 }
}
function snapshot(changes={}){
 const sourceText='```ts source="a.ts" lines="1-2"\nexport const state = 12;\nconsole.log(state);\n```';
 return {version:1,sessionId:"test-session",itemSemanticKey:"message:one",itemKind:"message",
   transcriptRevision:"r1",layoutRevision:"w80",sourceText,
   renderedLines:changes.itemKind==="tool"?["  export const state = 12;","  console.log(state);"]:
     ["```ts","  export const state = 12;","  console.log(state);","```"],renderedStartRow:10,
   visualCursor:{row:changes.itemKind==="tool"?11:12,col:16},screenCursor:{row:5,col:17},...changes};
}

test("extension registers source guidance and rendering hook without a viewer or model tool",()=>workspace(async root=>{
 const h=harness(root);
 assert.deepEqual(h.commands,[]);
 const event={systemPromptOptions:{sections:{existing:"keep"}}};
 h.listeners.get("before_agent_start")(event);
 assert.equal(event.systemPromptOptions.sections.existing,"keep");
 assert.match(event.systemPromptOptions.sections.intellisense_sources,/current workspace's language server automatically/);
 assert.match(event.systemPromptOptions.sections.intellisense_sources,/no source annotations or prior file reads are required/);
 const raw=snapshot().sourceText;
 assert.equal(h.transformers[0](raw,{messageType:"assistant"}),raw.replace(' source="a.ts" lines="1-2"',""));
 assert.equal(h.transformers[0](raw,{messageType:"user"}),raw);
 await h.start();await h.shutdown();
}));

test("registered native K uses annotated source through the real framed LSP adapter and inline overlay",()=>workspace(async root=>{
 const h=harness(root);
 try{
   await h.start();await h.registration().invoke("hover",snapshot());
   assert.deepEqual(h.notices,[]);assert.equal(h.overlays.length,1);
   assert.equal(h.overlays[0].options.overlay,true);
   assert.match(h.overlays[0].text,/actual mock hover/);
   assert.match(h.overlays[0].text,/1:12/);
 }finally{await h.shutdown();}
}));

test("registered native K resolves raw read output using exact persisted tool identity",()=>workspace(async root=>{
 const h=harness(root),code="export const state = 12;\nconsole.log(state);";
 h.ctx.sessionManager.getBranch=()=>[
   {type:"message",message:{role:"assistant",content:[{type:"toolCall",id:"call1",name:"read",arguments:{path:"a.ts"}}]}},
   {type:"message",id:"read1",message:{role:"toolResult",toolCallId:"call1",toolName:"read",content:[{type:"text",text:code}]}}
 ];
 try{
   await h.start();await h.registration().invoke("hover",snapshot({itemKind:"tool",toolCallId:"call1",sourceText:undefined}));
   assert.deepEqual(h.notices,[]);assert.match(h.overlays[0].text,/1:12/);
 }finally{await h.shutdown();}
}));

test("stale annotated source is reported locally without querying or opening another viewer",()=>workspace(async root=>{
 const h=harness(root);
 try{
   await h.start();await writeFile(path.join(root,"a.ts"),"changed();\nconsole.log(state);\n");
   await h.registration().invoke("hover",snapshot());
   assert.equal(h.overlays.length,0);assert.match(h.notices.join(" "),/no longer matches/);
 }finally{await h.shutdown();}
}));

test("session replacement disposes registration and rejects old snapshots without duplicate listeners",()=>workspace(async root=>{
 const h=harness(root);
 await h.start();const old=h.registration();await h.start();
 assert.equal(h.events.filter(event=>event.name==="pi-intellisense:unregister:v1").length,1);
 await assert.rejects(old.invoke("hover",snapshot()),/disposed/);
 await h.registration().invoke("hover",snapshot());
 assert.equal(h.overlays.length,1);
 await h.shutdown();await h.shutdown();
 assert.equal(h.events.filter(event=>event.name==="pi-intellisense:unregister:v1").length,2);
}));

test("ordinary assistant fences use workspace LSP without prior reads or virtual files",()=>workspace(async root=>{
 const h=harness(root);
 try{
   await h.start();await h.registration().invoke("hover",snapshot({sourceText:snapshot().sourceText.replace(' source="a.ts" lines="1-2"',"")}));
   assert.deepEqual(h.notices,[]);assert.match(h.overlays[0].text,/actual mock hover/);
   assert.match(h.overlays[0].text,/0:13/);
   assert.doesNotMatch(h.overlays[0].text,/Snippet only/);
   await assert.rejects(import("node:fs/promises").then(fs=>fs.stat(path.join(root,".pi-intellisense-virtual"))),{code:"ENOENT"});
 }finally{await h.shutdown();}
}));
