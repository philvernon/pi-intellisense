import {normalizeLocations,normalizeHover} from "../lsp/normalize.ts";
import {showInlineHover} from "./inline-hover.ts";
import {placeHoverOverlay} from "./overlay-geometry.ts";
import {truncateToWidth,matchesKey,Key} from "@earendil-works/pi-tui";
import {stripAnsi} from "../positions.mjs";
export function createNativeTranscriptController({ui,lsp,neovim,resolveSymbol,findWorkspaceSymbols,getSession,geometry,validateTarget,validateSource,requestEditorFocus}:any){
 let active=true,revision=0,abort:AbortController|null=null;
 const current=(s:any)=>{const now=getSession();return active&&now.sessionId===s.sessionId&&now.transcriptRevision===s.transcriptRevision&&
   (typeof s.isCurrent!=="function"||s.isCurrent());};
 async function chooseLocation(action:string,locations:any[],snapshot:any,signal:AbortSignal){
   if(locations.length===1)return locations[0];
   const options=placeHoverOverlay({anchor:snapshot.screenCursor,
     tooltip:{width:64,height:Math.min(14,locations.length+2)},
     terminal:geometry?.terminal??{rows:process.stdout.rows||42,cols:process.stdout.columns||120},
     protectedRows:geometry?.protectedRows??{top:1,bottom:5}});
   let dismissPicker:(()=>void)|undefined;
   const cancelPicker=()=>dismissPicker?.();
   signal.addEventListener("abort",cancelPicker,{once:true});
   const showPicker=()=>ui.custom((tui:any,theme:any,_keys:any,done:any)=>{
     dismissPicker=()=>done(null);
     if(signal.aborted)dismissPicker();
     let focus=0;
     return {render(width:number){return [
       truncateToWidth(theme.fg("accent","Choose "+action+" location"),width),
       ...locations.slice(Math.max(0,focus-11),Math.max(12,focus+1)).map((x:any,i:number)=>{
         const selected=i+Math.max(0,focus-11)===focus;
         const uri=stripAnsi(x.uri).replace(/[\x00-\x1f\x7f]/gu,"");
         return truncateToWidth(theme.fg(selected?"accent":"text",(selected?"> ":"  ")+uri+":"+(x.line+1)+":"+(x.character+1)),width);
       })];},
       handleInput(key:string){if(matchesKey(key,Key.escape))done(null);
         else if(matchesKey(key,Key.tab)){done(null);requestEditorFocus?.(snapshot);}
         else if(key==="j"||key==="\x1b[B"){focus=Math.min(locations.length-1,focus+1);tui.requestRender?.();}
         else if(key==="k"||key==="\x1b[A"){focus=Math.max(0,focus-1);tui.requestRender?.();}
         else if(matchesKey(key,Key.enter))done(locations[focus]);
       },invalidate(){}};
   },{overlay:true,overlayOptions:options});
   try{return await (snapshot.withNavigationPicker?snapshot.withNavigationPicker(showPicker):showPicker());}
   finally{signal.removeEventListener("abort",cancelPicker);}
 }
 async function invoke(action:string,snapshot:any){
   if(!current(snapshot))return;
   abort?.abort();abort=new AbortController();const signal=abort.signal,id=++revision;
   const still=()=>current(snapshot)&&id===revision&&!signal.aborted;
   const intentCurrent=()=>active&&id===revision&&!signal.aborted&&getSession().sessionId===snapshot.sessionId&&
     (typeof snapshot.isNavigationCurrent==="function"?snapshot.isNavigationCurrent():current(snapshot));
   let navigationStarted=false;
   let anchor;
   try{anchor=await resolveSymbol(snapshot);}
   catch(e){if(still())ui.notify?.(String(e));return;}
   if(!still())return;
   if(!anchor){ui.notify?.("Source mapping unavailable for symbol");return;}
   if(anchor.kind==="unmapped"){
     const reasons:any={
       "cursor-not-symbol":"No code symbol at the transcript cursor",
       "ambiguous":"Multiple source locations match; include more surrounding code",
       "virtual-document-unsupported":"Generated snippet needs a provider supporting virtual LSP documents",
       "source-unknown":"No source identity for this transcript item; update pi-tab-focus if needed",
       "source-unavailable":"Source is missing or outside the workspace",
       "invalid-annotation":"Invalid source annotation; use source=\"path\" lines=\"start-end\"",
       "stale-source":"The quoted range no longer matches the source file",
       "wrapped-unmappable":"Cannot map this wrapped, truncated, oversized or non-code transcript region"
     };
     ui.notify?.(reasons[anchor.reason]??"Unable to resolve transcript source");return;
   }
   try{
     if((anchor.kind==="virtual-document"||anchor.kind==="workspace-symbol-query")&&findWorkspaceSymbols){
       const symbols=await findWorkspaceSymbols(anchor,{signal});
       if(!still())return;
       if(!symbols.length){ui.notify?.("No workspace symbol found for "+anchor.token);return;}
       const selected=await chooseLocation("symbol",symbols,snapshot,signal);
       if(!selected||!still())return;
       anchor=selected;
     }
     const response=anchor.origin==="workspace-symbol"&&action==="definition"?
       {uri:anchor.uri,range:{start:anchor.position,end:anchor.position}}:
       await lsp.query({kind:action,uri:anchor.uri,position:anchor.position,
         documentVersion:anchor.fileHash,source:anchor,signal});
     if(!still())return;
     if(validateSource&&!(await validateSource(anchor))){
       if(still())ui.notify?.("Source changed during LSP request; retry");
       return;
     }
     if(!still())return;
     if(action==="hover"){
       const text=normalizeHover(response)?.markdown||"No hover information";
       const markup=anchor.kind==="virtual-document"?"Snippet only (no matching source file)\n\n"+text:text;
       await showInlineHover({ui,snapshot,signal,markup,onReturnToEditor:()=>requestEditorFocus?.(snapshot),geometry:geometry??{
         terminal:{rows:process.stdout.rows||42,cols:process.stdout.columns||120},
         protectedRows:{top:1,bottom:5}}});
       return;
     }
     const locations=normalizeLocations(response);
     if(!locations.length){
       ui.notify?.("No "+action+" location"+(anchor.kind==="virtual-document"?" — snippet has no matching source file; read the source first":""));
       return;
     }
     const open=async(loc:any)=>{if(!still())return;
       if(validateSource&&!(await validateSource(anchor))){
         if(still())ui.notify?.("Source changed during LSP navigation; retry");
         return;
       }
       const target=validateTarget?await validateTarget(loc):loc;
       const isCurrent=async()=>intentCurrent()&&(!validateSource||await validateSource(anchor))&&intentCurrent();
       if(target&&still()){
         navigationStarted=true;
         await neovim.open(target,{signal,isCurrent});
       }
     };
     const selected=await chooseLocation(action,locations,snapshot,signal);
     if(selected&&still())await open(selected);
   }catch(e){if(navigationStarted?intentCurrent():still())ui.notify?.(String((e as Error)?.message??e));}
 }
 return {invoke,dispose(){active=false;revision++;abort?.abort();}};
}
