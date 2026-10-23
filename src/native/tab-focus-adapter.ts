type FocusState={sessionId:string;mode:string;focused:boolean;transientFocused?:boolean;exDetour?:boolean;
 itemSemanticKey:string;itemKind:string;transcriptRevision:string;layoutRevision:string;
 visualCursor?:{row:number;col:number};screenCursor?:{row:number;col:number};
 selectedCodeRegionId?:string|null;sourceSpans?:readonly unknown[]};
const mapping:Record<string,string>={K:"hover",gd:"definition",gD:"declaration",gi:"implementation",
 gy:"typeDefinition",gr:"references",gs:"documentSymbols","[d":"previousDiagnostic","]d":"nextDiagnostic"};
export function createTabFocusNativeBridge({events,getFocus,legacyHandleKey}:any) {
 let disposed=false,registered:any=null,pending="";
 const unreg=events.on("pi-intellisense:register:v1",(value:any)=>{
   if(!disposed&&value.extensionId==="pi-intellisense"&&value.sessionId===getFocus().sessionId)registered=value;
 });
 const unreg2=events.on("pi-intellisense:unregister:v1",(value:any)=>{
   if(value.sessionId===registered?.sessionId)registered=null;
 });
 const handleKey=async(key:string)=>{
   const focus:FocusState=getFocus();
   if(disposed||!registered||!focus.focused||focus.mode!=="visual"||focus.transientFocused||focus.exDetour
       ||focus.sessionId!==registered.sessionId||!focus.visualCursor){
     pending="";return legacyHandleKey(key);
   }
   if(pending){
     const combo=pending+key;pending="";
     const operation=mapping[combo];
     if(operation&&registered.actions.includes(operation)){
       const snapshot=Object.freeze({version:1,sessionId:focus.sessionId,
         itemSemanticKey:focus.itemSemanticKey,itemKind:focus.itemKind,
         transcriptRevision:focus.transcriptRevision,layoutRevision:focus.layoutRevision,
         visualCursor:{...focus.visualCursor},screenCursor:focus.screenCursor?{...focus.screenCursor}:null,
         selectedCodeRegionId:focus.selectedCodeRegionId??null,sourceSpans:focus.sourceSpans??[]});
       await registered.invoke(operation,snapshot);return {handled:true};
     }
     legacyHandleKey(combo[0]);
     return legacyHandleKey(key);
   }
   if(key==="g"&&registered.actions.some((a:string)=>Object.values(mapping).includes(a))) {
     pending="g";return {handled:true};
   }
   const operation=mapping[key];
   if(operation&&registered.actions.includes(operation)){
     const snapshot=Object.freeze({version:1,sessionId:focus.sessionId,
       itemSemanticKey:focus.itemSemanticKey,itemKind:focus.itemKind,
       transcriptRevision:focus.transcriptRevision,layoutRevision:focus.layoutRevision,
       visualCursor:{...focus.visualCursor},screenCursor:focus.screenCursor?{...focus.screenCursor}:null,
       selectedCodeRegionId:focus.selectedCodeRegionId??null,sourceSpans:focus.sourceSpans??[]});
     await registered.invoke(operation,snapshot);return {handled:true};
   }
   return legacyHandleKey(key);
 };
 return {handleKey,dispose(){disposed=true;registered=null;unreg?.();unreg2?.();}};
}
