import test from "node:test";
import assert from "node:assert/strict";
import {createLspSession} from "../src/lsp.mjs";
import {createStdioLspTransport} from "../src/lsp-stdio.mjs";
import {encode,decode} from "../src/msgpack.mjs";
import {connectNeovim} from "../src/neovim-rpc.mjs";
import {openInNeovim} from "../src/neovim.mjs";
import {createServer} from "node:net";
import {join} from "node:path";
import {unlink} from "node:fs/promises";
import {fileURLToPath} from "node:url";

test("wire: binary MessagePack handles nested Neovim request and UTF-8 paths",()=>{
  const message=[0,7,"nvim_exec_lua",["return ...",["/project/é | x.ts",2,6]]];
  assert.deepEqual(decode(encode(message)).value,message);
  for(const msg of [[1,7,null,true],{value:"abc",num:65537,ok:true},["short",300,-3]])
    assert.deepEqual(decode(encode(msg)).value,msg);
});

test("wire: sends framed JSON-RPC initialize, hover and definition to real stdio child",async()=>{
  const file=fileURLToPath(new URL("./fixtures/lsp-server.mjs",import.meta.url));
  const transport=createStdioLspTransport({command:process.execPath,args:[file],cwd:process.cwd(),timeoutMs:2000});
  const session=createLspSession({transport,rootUri:"file:///project",languageId:"typescript"});
  try{
    await session.initialize();
    await session.open({uri:"file:///project/a.ts",text:"const x=2;\n",version:1});
    const hover=await session.hover({uri:"file:///project/a.ts",position:{line:0,character:6}});
    assert.match(hover.contents.value,/actual mock hover/);
    const result=await session.definition({uri:"file:///project/a.ts",position:{line:0,character:6}});
    assert.equal(result[0].range.start.line,1);
  }finally{await session.dispose();}
});

test("wire: speaks real Neovim Msgpack-RPC packet format using an isolated Unix socket",async()=>{
  const socket=join(process.cwd(),".pi-intel-wire-"+process.pid+".sock");
  await unlink(socket).catch(()=>{});
  const calls=[];
  const server=createServer(conn=>{
    let buf=Buffer.alloc(0);
    conn.on("data",chunk=>{
      buf=Buffer.concat([buf,chunk]);
      const value=decode(buf).value;
      calls.push(value);
      conn.write(encode([1,value[1],null,true]));
    });
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(socket,resolve);});
  try{
    const client=await connectNeovim(socket,{timeoutMs:1000});
    try{
      await openInNeovim({
        location:{path:"/repo/a é.ts",line:1,character:1},
        socket,rpc:client,fs:{readFile:async()=>"zero\né;\n"}
      });
      assert.equal(calls.length,1);
      assert.equal(calls[0][2],"nvim_exec_lua");
      assert.ok(calls[0][3][1].includes("/repo/a é.ts"));
      assert.ok(calls[0][3][1].includes(2));
      assert.ok(calls[0][3][1].includes(2),"character 1 after é maps to 2 UTF-8 bytes");
    }finally{client.close();}
  }finally{
    await new Promise(resolve=>server.close(resolve));
    await unlink(socket).catch(()=>{});
  }
});
