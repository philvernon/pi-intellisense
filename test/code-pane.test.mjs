import test from "node:test";
import assert from "node:assert/strict";
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {createServer} from "node:net";
import {decode,encode} from "../src/msgpack.mjs";
import {stripAnsi} from "../src/positions.mjs";
import {openCodePane} from "../src/ui/code-pane.ts";

const root=process.cwd(),file=join(root,"test/fixtures/source.ts");
function fakeContext(){
  let component,finish;
  const promise=new Promise(resolve=>{finish=resolve;});
  const ctx={ui:{custom(factory){
    component=factory({requestRender(){}},{fg:(_c,s)=>s},{},finish);
    return promise;
  }}};
  return {ctx,get component(){return component;},promise};
}
async function stable(get){
  for(let i=0;i<30;i++){
    const text=stripAnsi(get());
    if(!text.includes("Loading…")&&!text.includes("LSP hover…")&&!text.includes("LSP definition…"))return text;
    await new Promise(r=>setTimeout(r,5));
  }
  return stripAnsi(get());
}
function params(code,socket,query){
  return {block:{code},anchor:{kind:"disk-verified",path:file,startLine:0,startCharacter:0,
      sourceHash:createHash("sha256").update(code).digest("hex")},
    root,lspManager:{get:async()=>({query})},nvimSocket:socket,diagnostics:{}};
}
test("Pi code pane K calls LSP directly and displays hover without prompting the model",async()=>{
  const code=await fs.readFile(file,"utf8");
  const q=[];
  const h=fakeContext();
  const promise=openCodePane(h.ctx,params(code,undefined,async req=>{
    q.push(req);return {contents:{kind:"markdown",value:"**hover from language server**"}};
  }));
  h.component.handleInput("l");h.component.handleInput("K");
  await new Promise(r=>setTimeout(r,25));
  const screen=stripAnsi(h.component.render(100).join("\n"));
  assert.match(screen,/hover from language server/);
  assert.equal(q.length,1);
  assert.deepEqual(q[0].position,{line:0,character:1});
  h.component.handleInput("\x1b"); // close hover
  h.component.handleInput("\x1b"); // close code pane
  await promise;
});
test("Pi code pane gd resolves target and opens existing Neovim via MessagePack",async()=>{
  const code=await fs.readFile(file,"utf8");
  const socket=join(root,".pi-intel-pane-"+process.pid+".sock");
  await fs.unlink(socket).catch(()=>{});
  const calls=[];
  const server=createServer(conn=>{
    conn.on("data",bytes=>{
      const message=decode(bytes).value;
      calls.push(message);
      conn.write(encode([1,message[1],null,true]));
    });
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(socket,resolve);});
  try{
    const h=fakeContext();
    const promise=openCodePane(h.ctx,params(code,socket,async()=>[{
      uri:pathToFileURL(file).href,range:{start:{line:1,character:5},end:{line:1,character:9}}
    }]));
    h.component.handleInput("g");h.component.handleInput("d");
    await new Promise(r=>setTimeout(r,40));
    const screen=stripAnsi(h.component.render(100).join("\n"));
    assert.match(screen,/Opened .*source\.ts:2 in Neovim/);
    assert.equal(calls.length,1);
    assert.equal(calls[0][2],"nvim_exec_lua");
    h.component.handleInput("\x1b");
    await promise;
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await fs.unlink(socket).catch(()=>{});
  }
});
