import test from "node:test";
import assert from "node:assert/strict";

async function sut(){return import("../src/bridge/register.ts");}
function bus(){
  const handlers=new Map(),events=[];
  return {
    events,
    on(name,cb){let list=handlers.get(name);if(!list)handlers.set(name,list=new Set());list.add(cb);return ()=>list.delete(cb);},
    emit(name,payload){events.push({name,payload});for(const fn of handlers.get(name)??[])fn(payload);}
  };
}
const snapshot=Object.freeze({
  version:1,sessionId:"session-1",semanticKey:"message:1",kind:"message",
  sourceRevision:5,visualCursor:Object.freeze({row:12,col:6}),
  itemStartRow:10,itemEndRow:20,renderedLines:["const answer = 42;"]
});

test("extension registers with pi-tab-focus using versioned event contract",async()=>{
  const {registerTabFocusIntelliSense}=await sut();
  const events=bus(),seen=[];
  const handle=registerTabFocusIntelliSense({events,sessionId:"session-1",onAction:async(op,point)=>seen.push([op,point])});
  const registration=events.events.find(x=>x.name==="pi-intellisense:register:v1")?.payload;
  assert.ok(registration);
  assert.equal(registration.sessionId,"session-1");
  assert.equal(typeof registration.invoke,"function");
  await registration.invoke("hover",snapshot);
  assert.deepEqual(seen,[["hover",snapshot]]);
  handle.dispose();
});

test("bridge availability/reload does not install duplicate consumers",async()=>{
  const {registerTabFocusIntelliSense}=await sut();
  const events=bus(),seen=[];
  const handle=registerTabFocusIntelliSense({events,sessionId:"session-1",onAction:async(op)=>seen.push(op)});
  events.emit("pi-tab-focus:availability:v1",{sessionId:"session-1",available:true});
  events.emit("pi-tab-focus:availability:v1",{sessionId:"session-1",available:true});
  const count=events.events.filter(x=>x.name==="pi-intellisense:register:v1").length;
  assert.ok(count>=1);
  assert.ok(count<=2,"at most one initial binding and one replacement after availability");
  handle.dispose();
});

test("unregister on shutdown; callbacks cannot outlive session",async()=>{
  const {registerTabFocusIntelliSense}=await sut();
  const events=bus(),actions=[];
  const handle=registerTabFocusIntelliSense({events,sessionId:"session-1",onAction:async(op)=>actions.push(op)});
  const registration=events.events.find(x=>x.name==="pi-intellisense:register:v1").payload;
  handle.dispose();
  assert.equal(events.events.at(-1).name,"pi-intellisense:unregister:v1");
  await assert.rejects(registration.invoke("hover",snapshot),/disposed|session|unregistered/i);
  assert.equal(actions.length,0);
});

test("reject stale or invalid transcript cursors at extension boundary",async()=>{
  const {registerTabFocusIntelliSense}=await sut();
  const events=bus();
  const handle=registerTabFocusIntelliSense({events,sessionId:"session-1",onAction:async()=>{}});
  const invoke=events.events.find(x=>x.name==="pi-intellisense:register:v1").payload.invoke;
  await assert.rejects(invoke("definition",{...snapshot,sessionId:"other-session"}));
  await assert.rejects(invoke("hover",{...snapshot,version:99}));
  await assert.rejects(invoke("hover",{...snapshot,visualCursor:null}));
  handle.dispose();
});
