let pending="";
process.stdin.setEncoding("utf8");
process.stdin.on("data",chunk=>{
  pending+=chunk;
  while(pending.includes("\n")){
    const at=pending.indexOf("\n"),line=pending.slice(0,at);pending=pending.slice(at+1);
    if(!line.trim())continue;
    let message;
    try{message=JSON.parse(line);}catch{continue;}
    if(message.id===undefined)continue;
    let result;
    if(message.method==="initialize")result={protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"test-pilens",version:"1"}};
    else if(message.method==="tools/list")result={tools:[{name:"pilens_lsp_navigation"}]};
    else if(message.method==="tools/call"){
      const args=message.params?.arguments;
      if(message.params?.name!=="pilens_lsp_navigation")result={isError:true,content:[{type:"text",text:"Wrong name"}]};
      else result={content:[{type:"text",text:JSON.stringify({
        ok:true,operation:args.operation,result:args.operation==="hover"?"function f(): string":null,
        locations:args.operation==="definition"?[{uri:"file:///tmp/a.ts",range:{start:{line:3,character:4},end:{line:3,character:6}}}]:[]
      })}]};
    } else result={};
    process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:message.id,result})+"\n");
  }
});
