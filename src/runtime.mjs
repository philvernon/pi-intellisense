import path from "node:path";
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
  ".ts":"typescript",".tsx":"typescriptreact",".mts":"typescript",
  ".js":"javascript",".jsx":"javascriptreact",".mjs":"javascript",
  ".py":"python",".rs":"rust",".go":"go",".lua":"lua"
};
const normalizeLanguage=id=>id==="typescriptreact"?"typescript":id==="javascriptreact"?"javascript":id;
export function languageForFile(file){return LANG_BY_EXT[path.extname(file).toLowerCase()]??null;}
export function createLspManager({cwd,config={},onNotification=()=>{}}){
  const clients=new Map();
  async function get(file,text,{uri=pathToFileURL(file).href,languageId=languageForFile(file)}={}) {
    if(!languageId)throw new Error("No configured language server for "+path.extname(file));
    const family=normalizeLanguage(languageId);
    const configServer=config.servers?.[family]??DEFAULT_SERVERS[family];
    if(!configServer?.command || !Array.isArray(configServer.args))
      throw new Error("Configure an LSP server for "+family);
    const key=family+"\u0000"+cwd;
    if(!clients.has(key)){
      const transport=createStdioLspTransport({
        command:configServer.command,args:configServer.args,cwd,
        timeoutMs:config.timeoutMs??5000,onNotification
      });
      const client=createLspSession({transport,rootUri:pathToFileURL(cwd).href,languageId,timeoutMs:config.timeoutMs??5000});
      clients.set(key,client);
      try{await client.initialize();}catch(e){clients.delete(key);await transport.close().catch(()=>{});throw e;}
    }
    const client=clients.get(key);
    await client.open({uri,text,version:1});
    return client;
  }
  return {
    get,
    async close(){
      const all=[...clients.values()];clients.clear();
      await Promise.allSettled(all.map(client=>client.dispose()));
    }
  };
}
