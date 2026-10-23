import {normalizeLocations,normalizeHover} from "../lsp/normalize.ts";
import {showInlineHover} from "./inline-hover.ts";
import {placeHoverOverlay} from "./overlay-geometry.ts";
export function createNativeTranscriptController({ui,lsp,neovim,resolveSymbol,getSession,geometry,validateTarget,validateSource,requestEditorFocus}:any){
 let active=true,revision=0,abort:AbortController|null=null;
 const current=(s:any)=>{const now=getSession();return active&&now.sessionId===s.sessionId&&now.transcriptRevision===s.transcriptRevision&&
   (typeof s.isCurrent!=="function"||s.isCurrent());};
 async function invoke(action:string,snapshot:any){
   if(!current(snapshot))return;
   abort?.abort();abort=new AbortController();const signal=abort.signal,id=++revision;
   const still=()=>current(snapshot)&&id===revision&&!signal.aborted;
   let anchor;
   try{anchor=await resolveSymbol(snapshot);}
   catch(e){ui.notify?.(String(e));return;}
   if(!still())return;
   if(!anchor){ui.notify?.("Source mapping unavailable for symbol");return;}
   if(anchor.kind==="unmapped"){
     const reasons:any={
       "cursor-not-symbol":"No code symbol at the transcript cursor",
       "ambiguous":"Multiple matching sources; choose or bind a file",
       "virtual-document-unsupported":"Generated snippet needs a provider supporting virtual LSP documents",
       "source-unknown":"No verified source or supported code fence at this cursor"
     };
     ui.notify?.(reasons[anchor.reason]??"Unable to resolve transcript source");return;
   }
   try{
     const response=await lsp.query({kind:action,uri:anchor.uri,position:anchor.position,
       documentVersion:anchor.fileHash,source:anchor,signal});
     if(!still())return;
     if(action==="hover"||action==="signatureHelp"||action==="completion"){
       const text=action==="hover"?normalizeHover(response)?.markdown||"No hover information":
         JSON.stringify(response??"No information",null,2);
       await showInlineHover({ui,snapshot,markup:text,onReturnToEditor:()=>requestEditorFocus?.(snapshot),geometry:geometry??{
         terminal:{rows:process.stdout.rows||42,cols:process.stdout.columns||120},
         protectedRows:{top:1,bottom:5}}});
       return;
     }
     const locations=normalizeLocations(response);
     if(!locations.length){ui.notify?.("No "+action+" location");return;}
     const open=async(loc:any)=>{if(!still())return;
       if(validateSource&&!(await validateSource(anchor))){
         if(still())ui.notify?.("Source changed during LSP navigation; retry");
         return;
       }
       const target=validateTarget?await validateTarget(loc):loc;
       if(target&&still())await neovim.open(target);
     };
     if(locations.length===1){await open(locations[0]);return;}
     const options=placeHoverOverlay({anchor:snapshot.screenCursor,
       tooltip:{width:64,height:Math.min(14,locations.length+2)},
       terminal:geometry?.terminal??{rows:process.stdout.rows||42,cols:process.stdout.columns||120},
       protectedRows:geometry?.protectedRows??{top:1,bottom:5}});
     const selected=await ui.custom((tui:any,theme:any,_keys:any,done:any)=>{
       let focus=0;
       return {render(width:number){return [
         theme.fg("accent","Choose "+action+" location"),
         ...locations.slice(0,12).map((x:any,i:number)=>
           theme.fg(i===focus?"accent":"text",(i===focus?"> ":"  ")+x.uri+":"+(x.line+1)+":"+(x.character+1)))
         ];},
         handleInput(key:string){if(key==="\x1b")done(null);
           else if(key==="j"||key==="\x1b[B"){focus=Math.min(locations.length-1,focus+1);tui.requestRender?.();}
           else if(key==="k"||key==="\x1b[A"){focus=Math.max(0,focus-1);tui.requestRender?.();}
           else if(key==="\r"||key==="\n")done(locations[focus]);
         },invalidate(){}};
     },{overlay:true,overlayOptions:options});
     if(selected&&still())await open(selected);
   }catch(e){if(still())ui.notify?.(String((e as Error)?.message??e));}
 }
 return {invoke,dispose(){active=false;revision++;abort?.abort();}};
}
