import type {ExtensionAPI, ExtensionContext} from "@earendil-works/pi-coding-agent";
import {promises as fs} from "node:fs";
import {createHash} from "node:crypto";
import {homedir} from "node:os";
import path from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {extractFencedBlocks} from "./blocks.mjs";
import {resolveSourceAnchor} from "./provenance.mjs";
import {resolveSourceAtCursor} from "./provenance/source-map.ts";
import {createLspManager} from "./runtime.mjs";
import {registerTabFocusIntelliSense} from "./bridge/register.ts";
import {normalizeLocations,validateFileLocation,within} from "./locations.mjs";
import {stripAnsi} from "./positions.mjs";
import {openInNeovim} from "./neovim.mjs";
import {connectNeovim} from "./neovim-rpc.mjs";
import {openCodePane} from "./ui/code-pane.ts";
import {createNativeTranscriptController} from "./native/native-controller.ts";
import {resolveLiveTranscriptSymbol} from "./native/live-source.ts";

const SHA=(s:string)=>createHash("sha256").update(s).digest("hex");
const MAX_FILE=250_000;
const DEFAULT_CONFIG={timeoutMs:5000,servers:{},nvimSocket:"env:NVIM"};
type AnyCtx=ExtensionContext & {sessionManager:any};
function textParts(message:any):string[] {
  const value=message?.content;
  if(typeof value==="string")return [value];
  if(!Array.isArray(value))return [];
  return value.filter(p=>p&&p.type==="text"&&typeof p.text==="string").map(p=>p.text);
}
function chatBlocks(ctx:AnyCtx) {
  const entries=ctx.sessionManager.getBranch()??[];
  const blocks:any[]=[];
  const readCalls=new Map<string,string>();
  for(let index=0;index<entries.length;index++){
    const entry=entries[index],message=entry?.message;
    if(entry?.type!=="message"||!message)continue;
    // Only structured, persisted read-tool arguments can suggest a candidate path.
    // A path remains untrusted until exact bytes are verified against the file.
    if(message.role==="assistant"&&Array.isArray(message.content)){
      for(const part of message.content) {
        if(part?.type==="toolCall"&&part.name==="read"&&typeof part.id==="string") {
          const proposed=part.arguments?.path;
          if(typeof proposed==="string")readCalls.set(part.id,proposed);
        }
      }
    }
    if(message.role==="toolResult"&&message.toolName==="read"&&!message.isError){
      const hint=readCalls.get(message.toolCallId);
      if(hint){
        for(const original of textParts(message)){
          if(!original.trim()||original.length>250_000)continue;
          const lines=original.replace(/\r\n/gu,"\n").split("\n");
          const labeled=lines.map(x=>/^\s*(\d+)(?::|\s*[│|])\s?(.*)$/u.exec(x));
          const found=labeled.filter(Boolean);
          let code=original;
          if(found.length>0&&found.length>=lines.filter(x=>x.trim()).length-1){
            // Reconstruct only consecutively numbered content. Ignore wrappers.
            const nums=found.map(x=>Number(x![1]));
            if(nums.every((n,i)=>i===0||n===nums[i-1]+1))
              code=found.map(x=>x![2]).join("\n")+"\n";
          }
          if(!code.trim())continue;
          blocks.push({id:"read:"+String(entry.id??index),messageId:entry.id??String(index),
            origin:"toolResult",language:path.extname(hint).slice(1),code,
            candidatePath:hint});
          if(blocks.length>=200)return blocks;
        }
        continue;
      }
    }
    for(const content of textParts(message)){
      for(const block of extractFencedBlocks(content,{messageId:entry.id??String(index),origin:message.role??"unknown"})){
        blocks.push(block);
        if(blocks.length>=200)return blocks;
      }
    }
  }
  return blocks;
}
async function configFromDisk() {
  const pathName=path.join(homedir(),".pi","agent","pi-intellisense.json");
  try {
    const text=await fs.readFile(pathName,"utf8");
    const data=JSON.parse(text);
    if(!data||typeof data!=="object")return DEFAULT_CONFIG;
    const servers:Record<string,any>={};
    for(const [lang,server] of Object.entries(data.servers??{})){
      if(server&&typeof (server as any).command==="string"&&Array.isArray((server as any).args)&&
        (server as any).args.every((a:any)=>typeof a==="string"))
        servers[lang]=server;
    }
    return {...DEFAULT_CONFIG,timeoutMs:Number.isInteger(data.timeoutMs)&&data.timeoutMs>0?data.timeoutMs:5000,
      nvimSocket:typeof data.nvimSocket==="string"?data.nvimSocket:"env:NVIM",servers};
  } catch{return DEFAULT_CONFIG;}
}
function configuredSocket(config:any):string|undefined {
  const configured=config.nvimSocket==="env:NVIM"?(process.env.PI_INTELLISENSE_NVIM??process.env.NVIM):config.nvimSocket;
  return configured&&path.isAbsolute(configured)?configured:undefined;
}
function sessionId(ctx:AnyCtx):string {
  return String(ctx.sessionManager.getSessionId?.()??ctx.sessionManager.getSessionFile?.()??"pi-session");
}
function rootFor(ctx:AnyCtx):string {return path.resolve(ctx.cwd);}
function usefulLabel(block:any,index:number){
  const head=block.code.split("\n").find((x:string)=>x.trim())?.trim().slice(0,65)??"(empty)";
  return String(index+1).padStart(3)+"  "+(block.language||"text")+"  "+head;
}
async function anchoredFile(root:string,requested:string){
  const candidate=path.resolve(root,requested);
  if(!within(root,candidate))throw new Error("Path outside current project");
  const canonical=await fs.realpath(candidate);
  if(!within(root,canonical))throw new Error("File resolves outside current project");
  const stat=await fs.stat(canonical);
  if(!stat.isFile()||stat.size>MAX_FILE)throw new Error("File missing or too large for IntelliSense");
  const code=await fs.readFile(canonical,"utf8");
  return {block:{id:canonical,code,language:path.extname(canonical).slice(1)},
    anchor:{kind:"disk-verified",path:canonical,sourceHash:SHA(code),startLine:0,startCharacter:0}};
}

async function showText(ctx:AnyCtx,title:string,body:string) {
  await ctx.ui.custom((tui:any,theme:any,keys:any,done:(v:any)=>void)=>{
    const safe=stripAnsi(body).replace(/[\x00-\x08\x0b-\x1f\x7f]/gu,"").split("\n");
    let off=0;
    return {
      render(width:number){
        const trim=(s:string)=>s.slice(0,Math.max(1,width));
        return [theme.fg("accent",trim(title+" · j/k scroll · Esc close")),
          ...safe.slice(off,off+Math.min(16,(process.stdout.rows||30)-8)).map(trim)];
      },
      handleInput(input:string){
        if(input==="\x1b"||input==="q"){done(undefined);return;}
        if(input==="j"||input==="\x1b[B")off=Math.min(Math.max(0,safe.length-10),off+1);
        if(input==="k"||input==="\x1b[A")off=Math.max(0,off-1);
        tui.requestRender();
      },
      invalidate(){}
    };
  });
}
export default function piIntelliSense(pi:ExtensionAPI){
  let active:AnyCtx|undefined;
  let config:any=DEFAULT_CONFIG,manager:ReturnType<typeof createLspManager>|undefined;
  let unregister:undefined|(()=>void);
  let nativeController: ReturnType<typeof createNativeTranscriptController>|undefined;
  let latestNativeRevision = "";
  const diagnostics:Record<string,any[]>={};

  async function ensureRuntime(ctx:AnyCtx) {
    config=await configFromDisk();
    manager??=createLspManager({cwd:rootFor(ctx),config,
      onNotification:(method:string,params:any)=>{
        if(method==="textDocument/publishDiagnostics"&&params?.uri)
          diagnostics[params.uri]=params.diagnostics??[];
      }});
    return manager;
  }
  async function destination(ctx:AnyCtx,location:any){
    const root=rootFor(ctx);
    const target=await validateFileLocation(location,{root});
    const socket=configuredSocket(config);
    if(!socket)throw new Error("No Neovim socket. Start nvim --listen /tmp/nvim-intel.sock and set PI_INTELLISENSE_NVIM.");
    const rpc=await connectNeovim(socket);
    try{await openInNeovim({location:{...target,encoding:"utf-16"},socket,rpc,fs});}
    finally{rpc.close();}
  }
  async function bridgeAction(operation:string,snapshot:any) {
    if(!active || !nativeController || active.mode!=="tui") return;
    latestNativeRevision = String(snapshot.transcriptRevision??"");
    await nativeController.invoke(operation,snapshot);
  }
  pi.on("session_start",(_event,ctx)=>{
    active=ctx as AnyCtx;
    const sid=sessionId(active);
    nativeController?.dispose();
    nativeController=createNativeTranscriptController({
      ui:ctx.ui,
      getSession:()=>({sessionId:sid,transcriptRevision:latestNativeRevision}),
      resolveSymbol:(snapshot:any)=>resolveLiveTranscriptSymbol(snapshot,{root:rootFor(ctx)}),
      lsp:{query:async(request:any)=>{
        const file=fileURLToPath(request.uri);
        if(!within(rootFor(ctx),file))throw new Error("Source outside workspace");
        const text=await fs.readFile(file,"utf8");
        const client=await (await ensureRuntime(ctx)).get(file,text);
        return client.query(request);
      }},
      neovim:{open:async(location:any)=>{
        await ensureRuntime(ctx);
        return destination(ctx,{uri:location.uri,
          selectionRange:{start:{line:location.line,character:location.character}}});
      }},
      validateTarget:async(location:any)=>{
        const confirmed=await validateFileLocation({uri:location.uri,
          selectionRange:{start:{line:location.line,character:location.character}}}, {root:rootFor(ctx)});
        return {uri:location.uri,line:confirmed.line,character:confirmed.character};
      }
    });
    const bus={
      on:(name:string,handler:(value:any)=>void)=>{
        const result=(pi.events as any).on(name,handler);
        return typeof result==="function"?result:()=>{(pi.events as any).off?.(name,handler);};
      },
      emit:(name:string,value:any)=>(pi.events as any).emit(name,value)
    };
    const registration=registerTabFocusIntelliSense({events:bus,sessionId:sid,onAction:bridgeAction});
    unregister=()=>registration.dispose();
  });
  pi.on("session_shutdown",async()=>{
    unregister?.();unregister=undefined;
    nativeController?.dispose();nativeController=undefined;latestNativeRevision="";active=undefined;
    await manager?.close();manager=undefined;
    for(const key of Object.keys(diagnostics))delete diagnostics[key];
  });
  pi.registerCommand("intel",{
    description:"Open read-only code navigation with LSP hover (K), definitions (gd) and Neovim jump",
    handler:async(args,ctx)=>{
      if(ctx.mode!=="tui"){ctx.ui.notify("IntelliSense requires Pi TUI mode","warning");return;}
      const projectRoot=rootFor(ctx as AnyCtx);
      let block:any,anchor:any;
      try {
        if(args?.trim()){
          const result=await anchoredFile(projectRoot,args.trim());
          block=result.block;anchor=result.anchor;
        }else{
          const blocks=chatBlocks(ctx as AnyCtx);
          if(!blocks.length){ctx.ui.notify("No finalized code fences in active session. Use /intel <file>.","info");return;}
          const labels=blocks.map(usefulLabel);
          const selected=await ctx.ui.select("Select a code block for IntelliSense",labels);
          if(selected===undefined)return;
          const index=labels.indexOf(selected);
          if(index<0)return;
          block=blocks[index];
          if(block.candidatePath) {
            const detected=await resolveSourceAnchor({
              block,root:projectRoot,candidate:{kind:"selected-file",path:block.candidatePath},fs
            });
            if(detected.kind==="disk-verified")anchor={...detected,startCharacter:detected.startCharacter??0};
          }
          if(!anchor){
            const bind=await ctx.ui.input("Source file path for this snippet (optional; Esc to skip)");
            if(bind?.trim()){
              const result=await resolveSourceAnchor({
                block,root:projectRoot,candidate:{kind:"selected-file",path:bind.trim()},fs
              });
              if(result.kind==="disk-verified")anchor={...result,startCharacter:result.startCharacter??0};
              else ctx.ui.notify(result.kind==="ambiguous"?
                "Snippet occurs multiple times. Open file directly with /intel <file>.":
                "Snippet not identical to file. LSP disabled for this block.","warning");
            }
          }
        }
        await openCodePane(ctx,{block,anchor,root:projectRoot,
          lspManager:await ensureRuntime(ctx as AnyCtx),
          nvimSocket:configuredSocket(config),diagnostics});
      }catch(error){ctx.ui.notify("IntelliSense: "+String((error as Error).message??error),"error");}
    }
  });
}