import { promises as fs } from "node:fs";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {truncateToWidth,matchesKey,Key} from "./terminal.mjs";
import {normalizeLocations,validateFileLocation} from "../locations.mjs";
import {stripAnsi} from "../positions.mjs";
import {openInNeovim} from "../neovim.mjs";
import {connectNeovim} from "../neovim-rpc.mjs";

function sane(text) {
  return stripAnsi(String(text)).replace(/[\x00-\x08\x0b-\x1f\x7f]/gu,"").replace(/\r/gu,"");
}
function hoverText(result) {
  const contents=result?.contents;
  if(!contents)return "No LSP hover information.";
  const values=Array.isArray(contents)?contents:[contents];
  return values.map(v=>typeof v==="string"?v:typeof v?.value==="string"?v.value:"").join("\n\n")||"No LSP hover information.";
}
function nextGrapheme(text,col,direction) {
  const starts=[...new Intl.Segmenter("en",{granularity:"grapheme"}).segment(text)].map(s=>s.index);
  starts.push(text.length);
  if(direction>0)return starts.find(x=>x>col)??text.length;
  return starts.filter(x=>x<col).at(-1)??0;
}
function wordMotion(text,col,direction){
  if(direction>0){const search=text.slice(Math.min(text.length,col+1));const m=/[\p{L}\p{N}_$]+/u.exec(search);return m?col+1+m.index:text.length;}
  const upto=text.slice(0,Math.max(0,col));const matches=[...upto.matchAll(/[\p{L}\p{N}_$]+/gu)];
  if(matches.length===0)return 0;
  const previous=matches.at(-1);
  return previous.index===col-previous[0].length && matches.length>1?matches.at(-2).index:previous.index;
}
function describeLocation(x) {
  try{return new URL(x.uri).pathname+":"+(x.selectionRange.start.line+1)+":"+(x.selectionRange.start.character+1);}
  catch{return "Invalid location";}
}

/** Stateful, model-free, read-only Pi code navigator using ctx.ui.custom(). */
export function openCodePane(ctx,{block,anchor,root,lspManager,nvimSocket,diagnostics={}}) {
  const code=block.code.replace(/\r\n/gu,"\n");
  const rows=code.split("\n");
  if(rows.length>1&&rows.at(-1)==="")rows.pop();
  if(!rows.length)rows.push("");
  return ctx.ui.custom((tui,theme,_bindings,done)=>{
    let row=0,col=0,top=0,pending="",pane="code",viewOffset=0;
    let message=anchor?"Verified source: "+anchor.path:"No verified source. Use /intel <file> or bind a matching snippet.";
    let body="",items=[],choice=0,listTop=0,requestId=0,busy=false,dead=false;
    let currentQuery:AbortController|undefined;
    const maxHeight=()=>Math.max(6,Math.min(18,(process.stdout.rows||28)-10));
    const invalidate=()=>tui.requestRender();
    const codeHeight=()=>Math.min(rows.length,maxHeight());
    const makeVisible=()=>{
      if(row<top)top=row;
      if(row>=top+codeHeight())top=Math.max(0,row-codeHeight()+1);
    };
    const select=async location=>{
      if(!location)return;
      try{
        const target=await validateFileLocation(location,{root});
        const rpc=await connectNeovim(nvimSocket);
        try{
          await openInNeovim({location:{...target,encoding:"utf-16"},socket:nvimSocket,rpc,fs});
          message="Opened "+target.path+":"+(target.line+1)+" in Neovim";
          pane="code";
        }finally{rpc.close();}
      }catch(error){message="Navigation failed: "+sane(error?.message??error);pane="code";}
      invalidate();
    };
    async function action(kind){
      currentQuery?.abort();
      const signal=new AbortController();currentQuery=signal;
      const token=++requestId;busy=true;message="LSP "+kind+"…";invalidate();
      try{
        if(!anchor||anchor.kind!=="disk-verified")throw new Error("No verified source mapping; use /intel <file>");
        if(sane(rows[row])!==rows[row])throw new Error("Cannot map code containing raw terminal control characters");
        const text=await fs.readFile(anchor.path,"utf8");
        const hash=createHash("sha256").update(text).digest("hex");
        if(hash!==anchor.sourceHash)throw new Error("Source changed on disk. Reopen /intel.");
        const client=await lspManager.get(anchor.path,text);
        if(dead||token!==requestId)return;
        const position={line:anchor.startLine+row,character:col+(row===0?anchor.startCharacter:0)};
        const uri=pathToFileURL(anchor.path).href;
        const result=kind==="previousDiagnostic"||kind==="nextDiagnostic"?null:
          await client.query({kind,uri,position,signal:signal.signal});
        if(dead||token!==requestId)return;
        if(kind==="hover"||kind==="signatureHelp"){
          body=sane(kind==="hover"?hoverText(result):
            (result?.signatures??[]).map(x=>x.label+"\n"+(x.documentation?.value??x.documentation??"")).join("\n\n")||"No signature help").slice(0,30000);
          pane="hover";viewOffset=0;
        }else if(kind==="completion"){
          const entries=Array.isArray(result)?result:result?.items??[];
          body=entries.slice(0,100).map(x=>x.label+"  "+(x.detail??"")).join("\n")||"No completions";
          pane="hover";viewOffset=0;
        }else if(kind==="documentSymbols"){
          const entries=Array.isArray(result)?result:[];
          const toLocation=x=>({uri,selectionRange:x.selectionRange??x.range});
          items=entries.filter(x=>(x.selectionRange??x.range)?.start).map(toLocation);
          if(items.length){choice=0;listTop=0;pane="locations";}else message="No document symbols.";
        }else if(kind==="previousDiagnostic"||kind==="nextDiagnostic"){
          const sourceDiagnostics=diagnostics[uri]??[];
          if(!sourceDiagnostics.length)throw new Error("No diagnostics for this file");
          const ordered=[...sourceDiagnostics].sort((a,b)=>a.range.start.line-b.range.start.line||a.range.start.character-b.range.start.character);
          const index=kind==="nextDiagnostic"?ordered.findIndex(x=>x.range.start.line>position.line||
              x.range.start.line===position.line&&x.range.start.character>position.character):
            ordered.findLastIndex(x=>x.range.start.line<position.line||
              x.range.start.line===position.line&&x.range.start.character<position.character);
          const diag=ordered[index<0?(kind==="nextDiagnostic"?0:ordered.length-1):index];
          row=Math.min(rows.length-1,Math.max(0,diag.range.start.line-anchor.startLine));
          col=diag.range.start.character;makeVisible();
          message=sane(diag.message);
        }else{
          const locations=normalizeLocations(result).slice(0,200);
          if(!locations.length)message="No "+kind+" locations.";
          else if(locations.length===1)await select(locations[0]);
          else{items=locations;choice=0;listTop=0;pane="locations";}
        }
      }catch(error){
        if(!dead&&token===requestId)message=sane(error?.message??error);
      }finally{if(!dead&&token===requestId){busy=false;invalidate();}}
    }
    function startKey(data) {
      if(matchesKey(data,Key.escape)){currentQuery?.abort();done(undefined);dead=true;requestId++;return;}
      if(data==="K"){void action("hover");return;}
      if(data==="g"){pending="g";return;}
      if(data==="["||data==="]"){pending=data;return;}
      if(data==="j"||matchesKey(data,Key.down)){row=Math.min(rows.length-1,row+1);col=Math.min(col,rows[row].length);}
      else if(data==="k"||matchesKey(data,Key.up)){row=Math.max(0,row-1);col=Math.min(col,rows[row].length);}
      else if(data==="h"||matchesKey(data,Key.left))col=nextGrapheme(rows[row],col,-1);
      else if(data==="l"||matchesKey(data,Key.right))col=nextGrapheme(rows[row],col,1);
      else if(data==="w")col=wordMotion(rows[row],col,1);
      else if(data==="b")col=wordMotion(rows[row],col,-1);
      else if(data==="G"){row=rows.length-1;col=0;}
      else if(data==="0")col=0;
      else if(data==="$")col=rows[row].length;
      else if(matchesKey(data,"ctrl+k")){void action("signatureHelp");}
      else if(matchesKey(data,"ctrl+space")){void action("completion");}
      else if(data==="y"){message="Read-only pane. pi-tab-focus yank remains available in transcript mode.";}
      makeVisible();invalidate();
    }
    return {
      render(width){
        const clip=t=>truncateToWidth(t,Math.max(1,width));
        const renderLine=(line,i)=>{
          const n=String(i+1).padStart(4)+" ";
          const source=sane(line);
          const use=i===row;
          const expand=t=>t.replace(/\t/gu,"    ");
          let text=expand(source);
          if(use){
            const loc=Math.min(col,source.length);
            const end=nextGrapheme(source,loc,1);
            const char=source.slice(loc,end)||" ";
            text=expand(source.slice(0,loc))+"\x1b[7m"+expand(char)+"\x1b[0m"+expand(source.slice(end));
          }
          return clip(theme.fg(use?"accent":"dim",n)+text);
        };
        const title=clip(theme.fg("accent","IntelliSense  ")+
          theme.fg("muted",anchor?.path??"unmapped snippet"));
        const help=clip(theme.fg("dim","h/j/k/l · w/b · gg/G · K hover · gd def · gr refs · gi impl · gy type · gD decl · Esc close"));
        const lines=[title,help];
        if(pane==="code"){
          for(let i=top;i<Math.min(rows.length,top+codeHeight());i++)lines.push(renderLine(rows[i],i));
          lines.push(clip(theme.fg(busy?"accent":"muted",busy?"Loading…":sane(message))));
        }else if(pane==="hover"){
          lines.push(clip(theme.fg("accent","LSP information · j/k scroll · Esc back")));
          const parts=body.split("\n");
          for(const line of parts.slice(viewOffset,viewOffset+maxHeight()))lines.push(clip(sane(line)));
          lines.push(clip(theme.fg("muted",String(Math.min(parts.length,viewOffset+maxHeight()))+"/"+parts.length)));
        }else if(pane==="locations"){
          lines.push(clip(theme.fg("accent","Select destination · j/k · Enter open · Esc back")));
          for(let i=listTop;i<Math.min(listTop+maxHeight(),items.length);i++){
            const target=items[i];
            lines.push(clip(theme.fg(choice===i?"accent":"muted",(choice===i?"> ":"  ")+describeLocation(target))));
          }
        }
        return lines;
      },
      handleInput(data){
        if(dead)return;
        if(pane==="hover"){
          if(matchesKey(data,Key.escape)||matchesKey(data,Key.enter)){pane="code";invalidate();return;}
          if(data==="j"||matchesKey(data,Key.down))viewOffset=Math.min(Math.max(0,body.split("\n").length-maxHeight()),viewOffset+1);
          if(data==="k"||matchesKey(data,Key.up))viewOffset=Math.max(0,viewOffset-1);
          invalidate();return;
        }
        if(pane==="locations"){
          if(matchesKey(data,Key.escape)){pane="code";invalidate();return;}
          if(data==="j"||matchesKey(data,Key.down))choice=Math.min(items.length-1,choice+1);
          if(data==="k"||matchesKey(data,Key.up))choice=Math.max(0,choice-1);
          if(choice<listTop)listTop=choice;
          else if(choice>=listTop+maxHeight())listTop=choice-maxHeight()+1;
          if(matchesKey(data,Key.enter))void select(items[choice]);
          invalidate();return;
        }
        if(pending){
          const combo=pending+data;pending="";
          const operations={gd:"definition",gD:"declaration",gi:"implementation",gy:"typeDefinition",
            gr:"references",gs:"documentSymbols","[d":"previousDiagnostic","]d":"nextDiagnostic"};
          if(operations[combo]){void action(operations[combo]);invalidate();return;}
          if(combo==="gg"){row=0;col=0;makeVisible();invalidate();return;}
          if(combo==="ge"){col=wordMotion(rows[row],col,-1);invalidate();return;}
          invalidate();return;
        }
        startKey(data);
      },
      invalidate(){}
    };
  });
}