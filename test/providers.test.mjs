import test from "node:test";
import assert from "node:assert/strict";
import {pathToFileURL} from "node:url";
import {createPiLensMcpProvider,piLensArguments,createProvider} from "../src/providers/index.mjs";

const uri=pathToFileURL("/tmp/repo/example.ts").href;

test("provider: standalone uses injected LSP pool without creating second client",async()=>{
 const calls=[];
 const p=createProvider({kind:"standalone",cwd:"/tmp/repo",
   standaloneQuery:async x=>{calls.push(x);return {contents:"typed info"};}});
 const result=await p.query({kind:"hover",uri,position:{line:4,character:6}});
 assert.deepEqual(result,{contents:"typed info"});
 assert.equal(calls.length,1);
});

test("provider: pi-lens MCP read-only tool gets 1-based positions and actual file path",()=>{
 assert.deepEqual(piLensArguments({kind:"hover",uri,position:{line:4,character:6},cwd:"/tmp/repo"}),{
   operation:"hover",path:"/tmp/repo/example.ts",line:5,character:7,
   apply:false,cwd:"/tmp/repo"
 });
 assert.throws(()=>piLensArguments({kind:"rename",uri,position:{line:1,character:2}}),/does not support/);
 assert.throws(()=>piLensArguments({kind:"hover",uri:"untitled://pi/snippet",position:{line:1,character:2}}),/verified file/);
});

test("provider: structured pi-lens MCP hover is normalized into LSP hover shape",async()=>{
 let calls=[];
 const p=createPiLensMcpProvider({cwd:"/tmp/repo",client:{
   async call(name,args){calls.push({name,args});return {
     content:[{type:"text",text:JSON.stringify({ok:true,operation:"hover",result:"(function) demo(): void"})}]};}
 }});
 const result=await p.query({kind:"hover",uri,position:{line:2,character:0}});
 assert.deepEqual(result,{contents:"(function) demo(): void"});
 assert.equal(calls[0].name,"pilens_lsp_navigation");
 assert.equal(calls[0].args.character,1);
});

test("provider: pi-lens MCP handles normalized file results and explicit tool errors",async()=>{
 const p=createPiLensMcpProvider({cwd:"/tmp/repo",client:{
   async call(){return {content:[{type:"text",text:JSON.stringify({
     ok:true,locations:[{uri,range:{start:{line:8,character:2},end:{line:8,character:7}}}]
   })}]};}
 }});
 const result=await p.query({kind:"definition",uri,position:{line:1,character:0}});
 assert.equal(result[0].range.start.line,8);
 const err=createPiLensMcpProvider({cwd:"/tmp/repo",client:{
   async call(){return {isError:true,content:[{type:"text",text:"LSP crashed"}]};}
 }});
 await assert.rejects(err.query({kind:"hover",uri,position:{line:0,character:0}}),/LSP crashed/);
});
