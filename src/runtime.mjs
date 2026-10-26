import path from "node:path";
import {readdir,readFile} from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {createStdioLspTransport} from "./lsp-stdio.mjs";
import {createLspSession} from "./lsp.mjs";

const DEFAULT_SERVERS={
  typescript:{command:"typescript-language-server",args:["--stdio"]},
  javascript:{command:"typescript-language-server",args:["--stdio"]},
  python:{command:"basedpyright-langserver",args:["--stdio"]},
  rust:{command:"rust-analyzer",args:[]},
  go:{command:"gopls",args:[]},
  lua:{command:"lua-language-server",args:[]}
};
export const LANG_BY_EXT={
  ".ts":"typescript",".tsx":"typescriptreact",".mts":"typescript",".cts":"typescript",
  ".js":"javascript",".jsx":"javascriptreact",".mjs":"javascript",".cjs":"javascript",
  ".py":"python",".rs":"rust",".go":"go",".lua":"lua"
};
const normalizeLanguage=id=>id==="typescriptreact"?"typescript":id==="javascriptreact"?"javascript":id;
export function languageForFile(file){return LANG_BY_EXT[path.extname(file).toLowerCase()]??null;}
export function createLspManager({cwd,config={},onNotification=()=>{},createTransport=createStdioLspTransport}){
  const clients=new Map();
  let closed=false;
  const excluded=new Set(["node_modules","build","dist","vendor","target","coverage","out"]);
  async function sourceFile(languageId,signal){
    const queue=[path.join(cwd,"src"),cwd];
    const visited=new Set();
    while(queue.length){
      if(closed)throw new Error("LSP manager closed");
      if(signal?.aborted)throw new Error("LSP request cancelled");
      const dir=queue.shift();
      if(visited.has(dir))continue;
      visited.add(dir);
      const entries=await readdir(dir,{withFileTypes:true}).catch(error=>{
        if(error.code==="ENOENT")return [];
        throw error;
      });
      entries.sort((a,b)=>a.name.localeCompare(b.name));
      const directories=[];
      for(const entry of entries){
        if(entry.name.startsWith(".") || excluded.has(entry.name))continue;
        const file=path.join(dir,entry.name);
        if(entry.isDirectory())directories.push(file);
        else if(entry.isFile()){
          const id=languageForFile(file);
          if(id && (!languageId || normalizeLanguage(id)===normalizeLanguage(languageId)))return file;
        }
      }
      queue.unshift(...directories);
    }
    return null;
  }
  async function session(languageId,signal){
    if(closed)throw new Error("LSP manager closed");
    if(signal?.aborted)throw new Error("LSP request cancelled");
    if(!languageId)throw new Error("No configured language server");
    const family=normalizeLanguage(languageId);
    const configServer=config.servers?.[family]??DEFAULT_SERVERS[family];
    if(!configServer?.command || !Array.isArray(configServer.args))
      throw new Error("Configure an LSP server for "+family);
    const key=family+"\u0000"+cwd;
    if(!clients.has(key)){
      const transport=createTransport({
        command:configServer.command,args:configServer.args,cwd,
        timeoutMs:config.timeoutMs??5000,onNotification
      });
      const client=createLspSession({transport,rootUri:pathToFileURL(cwd).href,languageId,timeoutMs:config.timeoutMs??5000});
      const entry={client,ready:null,hasDocument:false,attachment:null};
      clients.set(key,entry);
      entry.ready=client.initialize().catch(async error=>{
        if(clients.get(key)===entry)clients.delete(key);
        await client.dispose().catch(()=>{});
        throw error;
      });
    }
    const entry=clients.get(key);
    await wait(entry.ready,signal);
    return entry;
  }
  async function wait(ready,signal){
    if(signal?.aborted)throw new Error("LSP request cancelled");
    if(signal){
      await new Promise((resolve,reject)=>{
        const abort=()=>{
          signal.removeEventListener("abort",abort);
          reject(new Error("LSP request cancelled"));
        };
        signal.addEventListener("abort",abort,{once:true});
        ready.then(resolve,reject).finally(()=>signal.removeEventListener("abort",abort));
      });
    }else await ready;
    if(closed)throw new Error("LSP manager closed");
    if(signal?.aborted)throw new Error("LSP request cancelled");
  }
  /** @param {{uri?:string,languageId?:string|null,signal?:AbortSignal}} options */
  async function get(file,text,options={}) {
    const {uri=pathToFileURL(file).href,languageId=languageForFile(file),signal}=options;
    if(!languageId)throw new Error("No configured language server for "+path.extname(file));
    const entry=await session(languageId,signal);
    await entry.client.open({uri,text,version:1});
    entry.hasDocument=true;
    return entry.client;
  }
  return {
    get,
    async workspaceSymbols({query,languageId,signal}={}){
      if(closed)throw new Error("LSP manager closed");
      if(signal?.aborted)throw new Error("LSP request cancelled");
      let file;
      if(!languageId){
        file=await sourceFile(null,signal);
        if(!file)throw new Error("No workspace source file found for language selection");
        languageId=languageForFile(file);
      }
      const entry=await session(languageId,signal);
      if(entry.client.capabilities.workspaceSymbolProvider && /^(typescript|javascript)$/.test(normalizeLanguage(languageId)) && !entry.hasDocument){
        if(!entry.attachment){
          entry.attachment=(async()=>{
            const source=file??await sourceFile(languageId);
            if(!source)throw new Error("No workspace source file found to attach "+languageId+" project");
            const text=await readFile(source,"utf8");
            if(closed)throw new Error("LSP manager closed");
            if(!entry.hasDocument){
              await entry.client.open({uri:pathToFileURL(source).href,text,version:1});
              entry.hasDocument=true;
            }
          })().catch(error=>{entry.attachment=null;throw error;});
        }
        await wait(entry.attachment,signal);
      }
      return entry.client.workspaceSymbols(query,{signal});
    },
    async close(){
      closed=true;
      const all=[...clients.values()];clients.clear();
      await Promise.allSettled(all.map(({client})=>client.dispose()));
    }
  };
}
