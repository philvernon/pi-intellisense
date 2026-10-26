import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {hideSourceAnnotations} from "./blocks.mjs";
import {createLspManager} from "./runtime.mjs";
import {registerTabFocusIntelliSense} from "./bridge/register.ts";
import {validateFileLocation,within} from "./locations.mjs";
import {createNeovimNavigator} from "./neovim-launcher.mjs";
import {createNativeTranscriptController} from "./native/native-controller.ts";
import {resolveTranscriptProvenance} from "./native/provenance-resolver.mjs";
import {symbolAtLine} from "./native/transcript-source.ts";
import {stripAnsi} from "./positions.mjs";
import {createProvider} from "./providers/index.mjs";

const SHA=(text:string)=>createHash("sha256").update(text).digest("hex");
const DEFAULT_CONFIG={timeoutMs:5000,servers:{},nvimSocket:"env:NVIM",provider:"standalone"};

function agentDirectory(){return process.env.PI_CODING_AGENT_DIR??path.join(homedir(),".pi","agent");}
async function configFromDisk(){
  try{
    const data=JSON.parse(await fs.readFile(path.join(agentDirectory(),"pi-intellisense.json"),"utf8"));
    if(!data||typeof data!=="object")return DEFAULT_CONFIG;
    const servers:Record<string,{command:string;args:string[]}>={};
    for(const [language,server] of Object.entries(data.servers??{})){
      const value=server as any;
      if(value&&typeof value.command==="string"&&Array.isArray(value.args)&&value.args.every((arg:any)=>typeof arg==="string"))
        servers[language]=value;
    }
    return {...DEFAULT_CONFIG,servers,
      timeoutMs:Number.isInteger(data.timeoutMs)&&data.timeoutMs>0?data.timeoutMs:5000,
      nvimSocket:typeof data.nvimSocket==="string"?data.nvimSocket:"env:NVIM",
      provider:data.provider==="pi-lens-mcp"?"pi-lens-mcp":"standalone",
      piLensServer:typeof data.piLensServer==="string"&&path.isAbsolute(data.piLensServer)?data.piLensServer:undefined};
  }catch{return DEFAULT_CONFIG;}
}
function configuredSocket(config:any){
  if(config.nvimSocket==="auto")return undefined;
  const socket=config.nvimSocket==="env:NVIM"?(process.env.PI_INTELLISENSE_NVIM??process.env.NVIM):config.nvimSocket;
  return socket&&path.isAbsolute(socket)?socket:undefined;
}

export default function piIntelliSense(pi:ExtensionAPI){
  let disposeSession:undefined|(()=>Promise<void>);
  pi.registerMarkdownTransformer((markdown,context)=>context.messageType==="assistant"?hideSourceAnnotations(markdown):markdown);
  pi.on("before_agent_start",event=>{
    event.systemPromptOptions.sections.intellisense_sources=[
      "Use ordinary language fences for code. IntelliSense uses the current workspace's language server automatically; no source annotations or prior file reads are required."
    ].join("\n");
  });
  pi.on("session_start",async(_event,ctx)=>{
    await disposeSession?.();
    const root=await fs.realpath(ctx.cwd);
    const sessionId=String(ctx.sessionManager.getSessionId?.()??ctx.sessionManager.getSessionFile?.()??"pi-session");
    const config=await configFromDisk();
    const navigator=createNeovimNavigator({cwd:root,timeoutMs:config.timeoutMs});
    let manager:ReturnType<typeof createLspManager>|undefined,provider:any;
    let transcriptRevision="",disposed=false;
    const runtime=()=>manager??=createLspManager({cwd:root,config});
    const query=async(request:any)=>{
      if(!provider)provider=createProvider({kind:config.provider,cwd:root,
        piLensServer:(config as any).piLensServer??path.join(agentDirectory(),"npm","node_modules","pi-lens","dist","mcp","server.js"),
        standaloneQuery:async(q:any)=>{
          const file=fileURLToPath(q.uri);
          if(!within(root,file))throw new Error("Source outside workspace");
          const text=await fs.readFile(file,"utf8");
          if(SHA(text)!==q.source.fileHash)throw new Error("Source changed since mapping; retry hover/navigation");
          return (await runtime().get(file,text,{signal:q.signal})).query(q);
        }});
      return provider.query(request);
    };
    const controller=createNativeTranscriptController({
      ui:ctx.ui,
      requestEditorFocus:()=>pi.events.emit("pi-intellisense:return-to-editor:v1",{sessionId}),
      getSession:()=>({sessionId,transcriptRevision}),
      resolveSymbol:async(snapshot:any)=>{
        const source=await resolveTranscriptProvenance(snapshot,{root,entries:ctx.sessionManager.getBranch()});
        if(source.kind!=="unmapped"||!["source-unknown","wrapped-unmappable","ambiguous"].includes(source.reason))return source;
        const row=snapshot.visualCursor?.row-snapshot.renderedStartRow;
        const text=stripAnsi(snapshot.renderedLines?.[row]??"");
        const symbol=symbolAtLine(text,text,snapshot.visualCursor?.col);
        return symbol?{kind:"workspace-symbol-query",token:symbol.token}:source;
      },
      findWorkspaceSymbols:async(source:any,{signal}:any)=>{
        const symbols=await runtime().workspaceSymbols({query:source.token,languageId:source.languageId,signal});
        const matches=new Map(),files=new Map<string,Promise<{text:string;fileHash:string}>>(),documents=new Map<string,Promise<any[]>>();
        const compare=(a:any,b:any)=>a.line-b.line||a.character-b.character;
        const flatten=(symbols:any[]):any[]=>symbols.flatMap(symbol=>[symbol,...flatten(symbol.children??[])]);
        for(const symbol of symbols){
          if(signal.aborted)return [];
          if(symbol.name!==source.token||!symbol.location?.range?.start)continue;
          const {uri,range}=symbol.location;
          try{
            const target=await validateFileLocation({uri,range},{root});
            if(!files.has(uri))files.set(uri,fs.readFile(target.path,"utf8").then(text=>({text,fileHash:SHA(text)})));
            const file=(await files.get(uri))!;
            let position=range.start;
            const line=file.text.split(/\r?\n/u)[position.line]??"";
            if(!line.slice(position.character).startsWith(source.token)){
              if(!documents.has(uri))documents.set(uri,(async()=>{
                const client=await runtime().get(target.path,file.text,{uri,signal});
                return client.capabilities.documentSymbolProvider?
                  flatten(await client.query({kind:"documentSymbols",uri,signal})??[]):[];
              })());
              const selections=(await documents.get(uri))!.filter(symbol=>symbol.name===source.token&&symbol.selectionRange&&
                compare(symbol.selectionRange.start,range.start)>=0&&compare(symbol.selectionRange.start,range.end)<0);
              const selected=selections.find(symbol=>compare(symbol.range.start,range.start)===0)??(selections.length===1?selections[0]:null);
              if(selected)position=selected.selectionRange.start;
            }
            const key=JSON.stringify([uri,position.line,position.character]);
            matches.set(key,{kind:"verified-file",origin:"workspace-symbol",uri,fileHash:file.fileHash,token:source.token,
              position,line:position.line,character:position.character});
          }catch{continue;}
        }
        return [...matches.values()];
      },
      lsp:{query},
      validateSource:async(source:any)=>{
        if(source.kind==="virtual-document")return true;
        if(!source.fileHash||!source.uri?.startsWith("file://"))return false;
        const file=fileURLToPath(source.uri);
        return within(root,file)&&SHA(await fs.readFile(file,"utf8").catch(()=>""))===source.fileHash;
      },
      validateTarget:async(location:any)=>{
        await validateFileLocation({uri:location.uri,selectionRange:{start:location}},{root});
        return location;
      },
      neovim:{open:async(location:any,options:any)=>{
        const target=await validateFileLocation({uri:location.uri,selectionRange:{start:location}},{root});
        return navigator.open({...target,encoding:"utf-16"},{...options,socket:configuredSocket(config)});
      }}
    });
    const registration=registerTabFocusIntelliSense({events:pi.events,sessionId,
      onAction:async(operation,snapshot)=>{
        if(disposed||ctx.mode!=="tui")return;
        transcriptRevision=String(snapshot.transcriptRevision??"");
        await controller.invoke(operation,snapshot);
      }});
    disposeSession=async()=>{
      if(disposed)return;
      disposed=true;registration.dispose();controller.dispose();
      await provider?.close?.();await manager?.close();
    };
  });
  pi.on("session_shutdown",async()=>{await disposeSession?.();disposeSession=undefined;});
}
