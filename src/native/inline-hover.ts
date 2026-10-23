import {placeHoverOverlay} from "./overlay-geometry.ts";
function sanitize(value:string) { return String(value).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu,"").replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu,"").replace(/[\x00-\x08\x0b-\x1f\x7f]/gu,""); }
export function showInlineHover({ui,snapshot,markup,geometry,focusState,onReturnToEditor}:any) {
 const anchor=snapshot.screenCursor;
 if(!anchor)return Promise.resolve();
 const opts=placeHoverOverlay({anchor,tooltip:{width:Math.min(68,Math.max(30,geometry.terminal.cols-4)),height:14},...geometry});
 const lines=sanitize(markup).split("\n").filter(line=>!/^\s*\x60{3,}(?:\w+)?\s*$/u.test(line));
 return ui.custom((tui:any,theme:any,_keys:any,done:any)=>{
   let top=0;
   return {
     render(width:number){
       const visible=lines.slice(top,top+Math.max(1,opts.maxHeight-2));
       return [theme.fg("accent","╭─ LSP hover ─"+"─".repeat(Math.max(0,width-15))+"╮").slice(0,width),
          ...visible.map((line,i)=>theme.fg(top+i===0?"accent":"text",line.slice(0,Math.max(1,width)))),
          theme.fg("dim","Esc close · j/k scroll").slice(0,width)];
     },
     handleInput(key:string) {
       if(key==="\x1b"||key==="escape")return done(undefined);
       if(key==="\t"||key==="tab") {
         done(undefined);
         onReturnToEditor?.();
         return;
       }
       if(key==="j"||key==="\x1b[B")top=Math.min(Math.max(0,lines.length-1),top+1);
       if(key==="k"||key==="\x1b[A")top=Math.max(0,top-1);
       tui.requestRender?.();
     },invalidate(){}
   };
 },{overlay:true,overlayOptions:opts});
}