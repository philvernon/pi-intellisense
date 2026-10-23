import test from "node:test";
import assert from "node:assert/strict";

async function sut(){return import("../src/controller.ts");}
const snapshot={
  version:1,sessionId:"s",semanticKey:"m:1",kind:"message",sourceRevision:2,
  visualCursor:{row:7,col:4},itemStartRow:5,itemEndRow:10,renderedLines:["const x = foo();"]
};
const sourceAnchor={sourceUri:"file:///repo/a.ts",sourceStart:{line:4,character:10},
  sourceEnd:{line:4,character:13},sourceVersion:"hash",confidence:"verified",origin:"read-tool"};
function harness({
  anchor=sourceAnchor,lspResult={contents:{kind:"markdown",value:"`foo()`: number"}},
  definitions=[{uri:"file:///repo/b.ts",range:{start:{line:20,character:5},end:{line:20,character:8}}}]
}={}){
  const requested=[],opened=[],hovers=[],errors=[],pickers=[];
  const lsp={query:async(req)=>{requested.push(req);return req.kind==="hover"?lspResult:definitions;}};
  const neovim={open:async(destination)=>opened.push(destination)};
  const ui={showHover:(s)=>hovers.push(s),showError:(s)=>errors.push(s),
    selectLocation:async(items)=>{pickers.push(items);return items[1];}};
  return {requested,opened,hovers,errors,pickers,lsp,neovim,ui,sourceAtCursor:async()=>anchor};
}

test("K hover makes one LSP query at source position and renders no model message",async()=>{
  const {createIntelliSenseController}=await sut();
  const h=harness();
  const c=createIntelliSenseController(h);
  await c.run("hover",snapshot);
  assert.equal(h.requested.length,1);
  assert.deepEqual(h.requested[0].position,{line:4,character:10});
  assert.equal(h.requested[0].kind,"hover");
  assert.match(h.hovers[0],/foo/);
  assert.deepEqual(h.opened,[]);
  c.dispose();
});

test("gd single target opens exact LSP location in remote Neovim",async()=>{
  const {createIntelliSenseController}=await sut();
  const h=harness();
  const c=createIntelliSenseController(h);
  await c.run("definition",snapshot);
  assert.equal(h.requested[0].kind,"definition");
  assert.deepEqual(h.opened,[{uri:"file:///repo/b.ts",line:20,character:5}]);
  assert.deepEqual(h.pickers,[]);
  c.dispose();
});

test("gd multiple targets requires an explicit choice",async()=>{
  const {createIntelliSenseController}=await sut();
  const targets=[{uri:"file:///repo/a.ts",range:{start:{line:0,character:0},end:{line:0,character:1}}},
    {uri:"file:///repo/b.ts",range:{start:{line:1,character:2},end:{line:1,character:3}}}];
  const h=harness({definitions:targets});
  const c=createIntelliSenseController(h);
  await c.run("definition",snapshot);
  assert.equal(h.pickers.length,1);
  assert.deepEqual(h.opened,[{uri:"file:///repo/b.ts",line:1,character:2}]);
  c.dispose();
});

test("no verifiable source must not query LSP or open Neovim",async()=>{
  const {createIntelliSenseController}=await sut();
  const h=harness({anchor:null});
  const c=createIntelliSenseController(h);
  await c.run("definition",snapshot);
  assert.equal(h.requested.length,0);
  assert.equal(h.opened.length,0);
  assert.match(h.errors.join(" "),/source|mapping|verif/i);
  c.dispose();
});
