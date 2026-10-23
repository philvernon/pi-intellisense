import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const READ_ONLY=new Set(["hover","definition","declaration","implementation",
  "typeDefinition","references","documentSymbols","signatureHelp"]);
const OPERATIONS={documentSymbols:"documentSymbol"};

export function piLensArguments({kind,uri,position,cwd}){
  if(!READ_ONLY.has(kind))throw new Error("pi-lens provider does not support "+kind);
  if(!uri.startsWith("file://"))throw new Error("pi-lens MCP needs a verified file source, not a virtual URI");
  const filePath=fileURLToPath(uri);
  return {operation:OPERATIONS[kind]??kind,path:filePath,
    ...(position?{line:position.line+1,character:position.character+1}:{}),
    apply:false,cwd};
}

function envelopeResult(content,kind){
  if(content?.isError)throw new Error(String(content.content?.[0]?.text??"pi-lens MCP query failed").slice(0,500));
  const text=content?.content?.find(x=>x?.type==="text")?.text;
  if(!text)throw new Error("pi-lens MCP did not return navigation data");
  let payload;
  try{payload=JSON.parse(text);}catch{throw new Error("pi-lens MCP returned unstructured navigation data");}
  if(payload.ok===false||payload.errors?.length)
    throw new Error(String(payload.errors?.[0]??"pi-lens LSP query failed"));
  if(kind==="hover"){
    const result=payload.result;
    if(typeof result==="string")return {contents:result};
    if(result?.contents)return result;
    if(result?.value)return {contents:{kind:"markdown",value:result.value}};
    if(result?.markdown)return {contents:{kind:"markdown",value:result.markdown}};
    return null;
  }
  if(Array.isArray(payload.locations)) {
    return payload.locations.map(loc=>{
      if(!loc)return null;
      if(loc.uri&&loc.range)return loc;
      if(loc.uri&&Number.isInteger(loc.line))
        return {uri:loc.uri,range:{start:{line:loc.line,character:loc.character??0},
          end:{line:loc.line,character:loc.character??0}}};
      if(loc.path&&Number.isInteger(loc.line))
        return {uri:"file://"+encodeURI(loc.path),range:{start:{line:loc.line,character:loc.character??0},
          end:{line:loc.line,character:loc.character??0}}};
      return null;
    }).filter(Boolean);
  }
  return payload.result??null;
}

export function createPiLensMcpProvider({cwd,client,closeClient}){
  return {kind:"pi-lens-mcp",supportsVirtualDocuments:false,
    async query(request){
      const args=piLensArguments({...request,cwd});
      const result=await client.call("pilens_lsp_navigation",args,{signal:request.signal});
      return envelopeResult(result,request.kind);
    },
    async close(){await closeClient?.();}
  };
}

export function createJsonLineMcpClient({command=process.execPath,args=[],cwd,env=process.env,timeoutMs=12000}){
  const child=spawn(command,args,{cwd,env,stdio:["pipe","pipe","pipe"],shell:false});
  let pending=new Map(),serial=0,buff="",closed=false,stderrTail="";
  child.stderr.on("data",chunk=>{stderrTail=(stderrTail+chunk.toString("utf8")).slice(-2400);});
  const fail=(error)=>{closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();};
  child.on("error",fail);
  child.on("exit",(code)=>fail(new Error("pi-lens MCP process exited: "+code+(stderrTail?" — "+stderrTail.split("\n").filter(Boolean).slice(-4).join(" | "):""))));
  child.stdout.on("data",chunk=>{
    buff+=chunk.toString("utf8");
    if(buff.length>2_000_000){fail(new Error("pi-lens MCP response too large"));child.kill();return;}
    while(buff.includes("\n")){
      const end=buff.indexOf("\n"),line=buff.slice(0,end);buff=buff.slice(end+1);
      if(!line.trim())continue;
      let msg;
      try{msg=JSON.parse(line);}catch{continue;}
      const p=pending.get(msg.id);
      if(!p)continue;
      pending.delete(msg.id);clearTimeout(p.timer);
      if(msg.error)p.reject(new Error(msg.error.message??"MCP error"));
      else p.resolve(msg.result);
    }
  });
  const request=(method,params,{signal}={})=>new Promise((resolve,reject)=>{
    if(closed)return reject(new Error("pi-lens MCP server closed"));
    const id=++serial;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error("pi-lens MCP timeout: "+method));},timeoutMs);
    const abort=()=>{pending.delete(id);clearTimeout(timer);reject(new Error("MCP request cancelled"));};
    if(signal?.aborted){clearTimeout(timer);return reject(new Error("MCP request cancelled"));}
    signal?.addEventListener("abort",abort,{once:true});
    const settle=(fn)=>(value)=>{signal?.removeEventListener("abort",abort);fn(value);};
    pending.set(id,{resolve:settle(resolve),reject:settle(reject),timer});
    child.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");
  });
  let init;
  const ready=async()=>{
    if(!init)init=request("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"pi-intellisense",version:"0.2"}}).then(async()=>{
      child.stdin.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"})+"\n");
      const found=await request("tools/list",{});
      if(!found?.tools?.some(t=>t.name==="pilens_lsp_navigation"))
        throw new Error("pi-lens MCP lsp_navigation tool unavailable");
    });
    return init;
  };
  return {async call(name,args,options){await ready();return request("tools/call",{name,arguments:args},options);},
    async close(){closed=true;fail(new Error("MCP client closing"));child.kill();}
  };
}

export function createProvider({kind="standalone",cwd,standaloneQuery,standaloneClose,piLensServer}){
  if(kind==="standalone")return {kind,supportsVirtualDocuments:false,query:standaloneQuery,
    close:()=>standaloneClose?.()};
  if(kind!=="pi-lens-mcp")throw new Error("Unknown IntelliSense provider: "+kind);
  const server=piLensServer??fileURLToPath(new URL("../../node_modules/pi-lens/dist/mcp/server.js",import.meta.url));
  const mcp=createJsonLineMcpClient({cwd,args:[server]});
  return createPiLensMcpProvider({cwd,client:mcp,closeClient:()=>mcp.close()});
}
