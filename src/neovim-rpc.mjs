import net from "node:net";
import {encode,decode} from "./msgpack.mjs";

export async function connectNeovim(socketPath,{timeoutMs=3000}={}){
  if(typeof socketPath!=="string"||!socketPath.startsWith("/"))throw new Error("Explicit absolute Neovim socket path required");
  const socket=net.createConnection({path:socketPath});
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.destroy();reject(new Error("Neovim socket connection timeout"));},timeoutMs);
    socket.once("connect",()=>{clearTimeout(timer);socket.off("error",reject);resolve();});
    socket.once("error",err=>{clearTimeout(timer);reject(err);});
  });
  let buf=Buffer.alloc(0),id=0,closed=false;
  const pending=new Map();
  function fail(error){
    if(closed)return;closed=true;
    for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}
    pending.clear();
  }
  socket.on("close",()=>fail(new Error("Neovim RPC socket closed")));
  socket.on("error",fail);
  socket.on("data",chunk=>{
    buf=Buffer.concat([buf,chunk]);
    if(buf.length>10_000_000){fail(new Error("Oversized Neovim RPC frame"));socket.destroy();return;}
    while(buf.length){
      let part;
      try{part=decode(buf);}catch(error){
        if(error instanceof RangeError && /incomplete/u.test(error.message))break;
        fail(error);socket.destroy();return;
      }
      buf=buf.subarray(part.offset);
      const msg=part.value;
      if(!Array.isArray(msg)||msg[0]!==1)continue;
      const p=pending.get(msg[1]);if(!p)continue;
      pending.delete(msg[1]);clearTimeout(p.timer);
      if(msg[2])p.reject(new Error("Neovim RPC: "+JSON.stringify(msg[2])));
      else p.resolve(msg[3]);
    }
  });
  return {
    request(method,args=[]){
      if(closed)return Promise.reject(new Error("Neovim socket closed"));
      return new Promise((resolve,reject)=>{
        const requestId=++id;
        const timer=setTimeout(()=>{pending.delete(requestId);reject(new Error("Neovim RPC timeout"));},timeoutMs);
        pending.set(requestId,{resolve,reject,timer});
        socket.write(encode([0,requestId,method,args]),err=>{
          if(err){pending.delete(requestId);clearTimeout(timer);reject(err);}
        });
      });
    },
    close(){fail(new Error("Neovim RPC disconnected"));socket.end();socket.destroy();}
  };
}
