import test from "node:test";
import assert from "node:assert/strict";
import {fileURLToPath} from "node:url";
import path from "node:path";
import piIntelliSense from "../src/index.ts";
import {stripAnsi} from "../src/positions.mjs";

function harness(){
  const commands=new Map(),listeners=new Map(),events=[];
  const pi={
    registerCommand(name,config){commands.set(name,config);},
    on(name,fn){listeners.set(name,fn);},
    events:{
      on(name,fn){events.push(["listen",name]);return ()=>{};},
      emit(name,payload){events.push(["emit",name,payload]);}
    }
  };
  const notices=[],rendered=[];
  const ctx={
    cwd:process.cwd(),mode:"tui",
    sessionManager:{
      getSessionId:()=>"test-session",
      getBranch:()=>[{id:"m1",type:"message",message:{role:"assistant",
        content:[{type:"text",text:"```ts\nconst a=1;\n```"}]}}]
    },
    ui:{
      notify(message,level){notices.push({message,level});},
      select:async(title,choices)=>choices[0],
      input:async()=>"test/fixtures/source.ts",
      custom(factory){
        return new Promise(resolve=>{
          const tui={requestRender(){}};
          const theme={fg:(color,value)=>value};
          const component=factory(tui,theme,{},resolve);
          rendered.push(component.render(80));
          component.handleInput("\x1b");
        });
      }
    }
  };
  piIntelliSense(pi);
  return {commands,listeners,events,ctx,notices,rendered};
}
test("Pi extension loads and registers /intel without triggering a model turn",async()=>{
  const h=harness();
  assert.ok(h.commands.has("intel"));
  assert.equal(typeof h.listeners.get("session_start"),"function");
  h.listeners.get("session_start")({},h.ctx);
  assert.ok(h.events.some(x=>x[1]==="pi-intellisense:register:v1"));
  await h.commands.get("intel").handler("test/fixtures/source.ts",h.ctx);
  assert.match(h.rendered.flat().join("\n"),/IntelliSense/);
  assert.match(stripAnsi(h.rendered.flat().join("\n")) ,/const café/);
  assert.equal(h.notices.filter(n=>n.level==="error").length,0);
  await h.listeners.get("session_shutdown")();
});
test("unmapped assistant block stays visible without false verified-file jump",async()=>{
  const h=harness();
  h.ctx.ui.input=async()=>undefined;
  h.listeners.get("session_start")({},h.ctx);
  await h.commands.get("intel").handler("",h.ctx);
  assert.match(h.rendered.flat().join("\n"),/unmapped snippet/);
  assert.equal(h.notices.filter(n=>n.level==="error").length,0);
  await h.listeners.get("session_shutdown")();
});
test("conversation read-tool result is matched against on-disk source without a path prompt",async()=>{
  const h=harness();
  h.ctx.sessionManager.getBranch=()=>[
    {type:"message",id:"assistant-1",message:{role:"assistant",content:[
      {type:"toolCall",id:"call-1",name:"read",arguments:{path:"test/fixtures/source.ts"}}
    ]}},
    {type:"message",id:"tool-1",message:{role:"toolResult",toolCallId:"call-1",toolName:"read",
      isError:false,content:[{type:"text",text:'1: const café = "😃";\n'}]}}
  ];
  h.ctx.ui.input=async()=>{throw new Error("verified tool result should not require manual file path");};
  h.listeners.get("session_start")({},h.ctx);
  await h.commands.get("intel").handler("",h.ctx);
  assert.match(h.rendered.flat().join("\n"),/Verified source:/);
  assert.equal(h.notices.filter(n=>n.level==="error").length,0);
  await h.listeners.get("session_shutdown")();
});