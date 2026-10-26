let buffer=Buffer.alloc(0),documentUri;
function send(msg){
  const json=Buffer.from(JSON.stringify({jsonrpc:"2.0",...msg}));
  process.stdout.write("Content-Length: "+json.length+"\r\n\r\n");
  process.stdout.write(json);
}
process.stdin.on("data",chunk=>{
  buffer=Buffer.concat([buffer,chunk]);
  while(true){
    const end=buffer.indexOf("\r\n\r\n");
    if(end<0)break;
    const m=/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0,end).toString());
    if(!m)process.exit(2);
    const length=Number(m[1]);if(buffer.length<end+4+length)break;
    const msg=JSON.parse(buffer.subarray(end+4,end+4+length).toString());
    buffer=buffer.subarray(end+4+length);
    if(msg.method==="initialize")send({id:msg.id,result:{capabilities:{
      textDocumentSync:1,hoverProvider:true,definitionProvider:true,
      referencesProvider:true,workspaceSymbolProvider:true,documentSymbolProvider:true,positionEncoding:"utf-16"
    }}});
    else if(msg.method==="textDocument/didOpen")documentUri=msg.params.textDocument.uri;
    else if(msg.method==="workspace/symbol")send({id:msg.id,result:documentUri?[{
      name:msg.params.query,kind:13,location:{uri:documentUri,
        range:{start:{line:0,character:0},end:{line:0,character:18}}}
    }]:[]});
    else if(msg.method==="textDocument/documentSymbol")send({id:msg.id,result:[{
      name:"state",kind:13,range:{start:{line:0,character:0},end:{line:1,character:19}},
      selectionRange:{start:{line:0,character:13},end:{line:0,character:18}}
    }]});
    else if(msg.method==="textDocument/hover")
      send({id:msg.id,result:{contents:{kind:"markdown",value:"**actual mock hover** "+msg.params.position.line+":"+msg.params.position.character}}});
    else if(msg.method==="textDocument/definition")
      send({id:msg.id,result:[{uri:msg.params.textDocument.uri,
        range:{start:{line:1,character:5},end:{line:1,character:10}}}]});
    else if(msg.method==="shutdown")send({id:msg.id,result:null});
    else if(msg.method==="exit")process.exit(0);
    else if(msg.id!==undefined)send({id:msg.id,result:null});
  }
});
