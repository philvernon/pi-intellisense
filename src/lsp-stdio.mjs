import { spawn } from "node:child_process";

export function createStdioLspTransport({command,args=[],cwd,timeoutMs=5000,onNotification=()=>{}}){
  if(!command||typeof command!=="string")throw new Error("Missing trusted LSP executable");
  const child=spawn(command,args,{cwd,shell:false,stdio:["pipe","pipe","pipe"],windowsHide:true});
  let seq=0,buffer=Buffer.alloc(0),closed=false;
  const pending=new Map(),stderr=[];
  const failure=(message)=>{
    closed=true;
    for(const [,p] of pending){clearTimeout(p.timer);p.reject(new Error(message));}
    pending.clear();
  };
  child.on("error",err=>failure("LSP failed to launch: "+err.message));
  child.on("exit",(code,signal)=>failure("Language server exited ("+(signal??code)+"): "+stderr.slice(-4).join(" ")));
  child.stderr.on("data",chunk=>{
    if(stderr.length>40)stderr.shift();
    stderr.push(String(chunk).replace(/[\x00-\x1f\x7f]/gu," ").slice(0,500));
  });
  const send=message=>{
    if(closed||!child.stdin.writable)throw new Error("Language server is not running");
    const json=Buffer.from(JSON.stringify({jsonrpc:"2.0",...message}),"utf8");
    child.stdin.write(Buffer.from("Content-Length: "+json.length+"\r\n\r\n","ascii"));
    child.stdin.write(json);
  };
  const handle=(message)=>{
    if(message.id!==undefined&&message.method){
      // Respond to common optional server-initiated configuration requests.
      const result=message.method==="workspace/configuration" ?
        (message.params?.items??[]).map(()=>null) : null;
      send({id:message.id,result});
      return;
    }
    if(message.id!==undefined){
      const p=pending.get(message.id);
      if(!p)return;
      pending.delete(message.id);clearTimeout(p.timer);p.cleanup();
      if(message.error)p.reject(new Error("LSP "+message.error.message));
      else p.resolve(message.result);
      return;
    }
    if(message.method)onNotification(message.method,message.params);
  };
  child.stdout.on("data",chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    if(buffer.length>16_000_000){failure("LSP frame exceeded size limit");child.kill();return;}
    while(true){
      const headerEnd=buffer.indexOf("\r\n\r\n");
      if(headerEnd<0)break;
      const header=buffer.subarray(0,headerEnd).toString("ascii");
      const m=/(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(header);
      if(!m){failure("Missing LSP Content-Length");child.kill();return;}
      const count=Number(m[1]);
      if(count>10_000_000){failure("LSP frame too large");child.kill();return;}
      if(buffer.length<headerEnd+4+count)break;
      const json=buffer.subarray(headerEnd+4,headerEnd+4+count);
      buffer=buffer.subarray(headerEnd+4+count);
      try{handle(JSON.parse(json.toString("utf8")));}catch(err){onNotification("pi-intellisense/protocolError",String(err));}
    }
  });
  return {
    request(method,params,{signal,timeoutMs:limit=timeoutMs}={}){
      if(signal?.aborted)return Promise.reject(new Error("LSP request cancelled"));
      return new Promise((resolve,reject)=>{
        const id=++seq;
        let timer;
        const cancel=()=>{
          if(!pending.has(id))return;
          pending.delete(id);clearTimeout(timer);
          signal?.removeEventListener("abort",cancel);
          try{send({method:"$/cancelRequest",params:{id}});}catch{}
          reject(new Error("LSP request aborted"));
        };
        if(signal)signal.addEventListener("abort",cancel,{once:true});
        const cleanup=()=>signal?.removeEventListener("abort",cancel);
        timer=setTimeout(()=>{
          if(!pending.has(id))return;
          pending.delete(id);cleanup();
          try{send({method:"$/cancelRequest",params:{id}});}catch{}
          reject(new Error("LSP request timed out"));
        },limit);
        pending.set(id,{resolve,reject,timer,cleanup});
        try{send({id,method,params});}catch(error){pending.delete(id);clearTimeout(timer);cleanup();reject(error);}
      });
    },
    async notify(method,params){send({method,params});},
    async close(){if(closed)return;failure("LSP transport closed");child.stdin.end();child.kill();}
  };
}