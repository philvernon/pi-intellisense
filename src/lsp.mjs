export function createLspSession({transport,rootUri,languageId,timeoutMs=5000}) {
  let initialized=false, disposed=false, capabilities={};
  const docs=new Map();
  function requireReady() {if (!initialized || disposed) throw new Error("LSP session not initialized or disposed");}
  async function initialize() {
    if (disposed) throw new Error("LSP session disposed");
    if (initialized) return;
    const params={
      processId:process.pid,rootUri,rootPath:null,workspaceFolders: rootUri ? [{uri:rootUri,name:"workspace"}]:null,
      clientInfo:{name:"pi-intellisense",version:"0.1.0"},
      capabilities:{workspace:{symbol:{resolveSupport:{properties:["location.range"]}}},general:{positionEncodings:["utf-16"]},textDocument:{
        hover:{contentFormat:["markdown","plaintext"]},definition:{linkSupport:true},
        references:{},completion:{completionItem:{snippetSupport:false}},
        declaration:{linkSupport:true},implementation:{linkSupport:true},typeDefinition:{linkSupport:true},
        documentSymbol:{hierarchicalDocumentSymbolSupport:true},signatureHelp:{}
      }}};
    // Dynamic syntax routing can return incomplete navto results while the project loads.
    if(/^(typescript|javascript)/.test(languageId))params.initializationOptions={tsserver:{useSyntaxServer:"never"}};
    const info=await transport.request("initialize",params);
    if (disposed) throw new Error("LSP session disposed");
    capabilities=info?.capabilities??{};
    if (capabilities.positionEncoding!==undefined && capabilities.positionEncoding!=="utf-16")
      throw new Error("Unsupported LSP position encoding: "+capabilities.positionEncoding+" (expected utf-16)");
    await transport.notify("initialized",{});
    if (disposed) throw new Error("LSP session disposed");
    initialized=true;
  }
  async function open({uri,text,version=1}) {
    requireReady();
    const current=docs.get(uri);
    if (current && current.text===text) return;
    if (current) {
      const next=Math.max(version,current.version+1);
      await transport.notify("textDocument/didChange",{textDocument:{uri,version:next},contentChanges:[{text}]});
      docs.set(uri,{text,version:next});
    } else {
      await transport.notify("textDocument/didOpen",{textDocument:{uri,languageId,version,text}});
      docs.set(uri,{text,version});
    }
  }
  function request(method, capability, {uri,position,signal,includeDeclaration=false}={}) {
    requireReady();
    if (!capabilities[capability]) throw new Error("Unsupported LSP capability: "+capability);
    if (!docs.has(uri)) throw new Error("LSP document must be opened before requesting");
    const params={textDocument:{uri},...(position?{position}:{})};
    if (method==="textDocument/references") params.context={includeDeclaration};
    return transport.request(method,params,{signal,timeoutMs});
  }
  const methodMap={
    hover:["textDocument/hover","hoverProvider"],
    definition:["textDocument/definition","definitionProvider"],
    declaration:["textDocument/declaration","declarationProvider"],
    implementation:["textDocument/implementation","implementationProvider"],
    typeDefinition:["textDocument/typeDefinition","typeDefinitionProvider"],
    references:["textDocument/references","referencesProvider"],
    completion:["textDocument/completion","completionProvider"],
    signatureHelp:["textDocument/signatureHelp","signatureHelpProvider"],
    documentSymbols:["textDocument/documentSymbol","documentSymbolProvider"]
  };
  const client={
    initialize,open,
    async workspaceSymbols(query,{signal}={}){
      requireReady();
      if(!capabilities.workspaceSymbolProvider)throw new Error("Unsupported LSP capability: workspaceSymbolProvider");
      const symbols=await transport.request("workspace/symbol",{query},{signal,timeoutMs});
      const results=[];
      const validPosition=p=>Number.isInteger(p?.line)&&p.line>=0&&Number.isInteger(p?.character)&&p.character>=0;
      for(let symbol of symbols??[]){
        if(!symbol.location?.range && capabilities.workspaceSymbolProvider.resolveProvider)
          symbol=await transport.request("workspaceSymbol/resolve",symbol,{signal,timeoutMs});
        const location=symbol?.location;
        if(typeof symbol?.name==="string" && typeof location?.uri==="string" && location.uri &&
          validPosition(location.range?.start) && validPosition(location.range?.end))results.push(symbol);
      }
      return results;
    },
    get capabilities(){return capabilities;},
    get positionEncoding(){return capabilities.positionEncoding??"utf-16";},
    async dispose(){
      if(disposed)return; disposed=true;
      try{
        if(!initialized)return;
        for(const uri of docs.keys()) await transport.notify("textDocument/didClose",{textDocument:{uri}}).catch(()=>{});
        docs.clear();
        await transport.request("shutdown",null).catch(()=>{});
        await transport.notify("exit",null).catch(()=>{});
      }finally{await transport.close?.();}
    },
    async query({kind,uri,position,signal,includeDeclaration}){
      const method=methodMap[kind];
      if(!method) throw new Error("Unsupported LSP operation: "+kind);
      return request(...method,{uri,position,signal,includeDeclaration});
    }
  };
  for (const kind of Object.keys(methodMap)) client[kind]=(args)=>client.query({...args,kind});
  return client;
}
