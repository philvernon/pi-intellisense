type Snapshot = {
  version: number; sessionId: string;
  itemSemanticKey: string;
  itemKind: string;
  transcriptRevision: string; layoutRevision: string;
  sourceText?: string; toolCallId?: string;
  renderedLines: string[]; renderedStartRow: number;
  isCurrent?:()=>boolean;
  isNavigationCurrent?:()=>boolean;
  withNavigationPicker?:<T>(run:()=>Promise<T>)=>Promise<T>;
  visualCursor: {row:number;col:number} | null;
  screenCursor?: {row:number;col:number};
};
export const INTELLISENSE_ACTIONS = [
  "hover", "definition", "references", "declaration", "implementation", "typeDefinition"
] as const;

export function registerTabFocusIntelliSense({events,sessionId,onAction}: {
  events:{on:(event:string,handler:(payload:any)=>void)=>()=>void;emit:(event:string,payload:any)=>void};
  sessionId:string;onAction:(operation:string,snapshot:Snapshot)=>Promise<void>;
}) {
  let disposed=false,seenEpoch:string|undefined;
  const invoke=async(operation:string,snapshot:Snapshot)=>{
    if(disposed)throw new Error("IntelliSense session disposed");
    if(snapshot?.version!==1||snapshot.sessionId!==sessionId||
      typeof snapshot.itemSemanticKey!=="string"||
      !snapshot.visualCursor||!Number.isInteger(snapshot.visualCursor.row)||
      !Number.isInteger(snapshot.visualCursor.col))
      throw new Error("Invalid or stale IntelliSense session snapshot");
    if(!INTELLISENSE_ACTIONS.includes(operation as any))throw new Error("Unsupported IntelliSense action");
    return onAction(operation,snapshot);
  };
  const register=()=>events.emit("pi-intellisense:register:v1",{
    sessionId,extensionId:"pi-intellisense",actions:[...INTELLISENSE_ACTIONS],invoke
  });
  const unsubscribe=events.on("pi-tab-focus:availability:v1",(payload:any)=>{
    if(disposed||payload?.sessionId!==sessionId)return;
    const epoch=String(payload?.bridgeVersion??1)+":"+String(payload?.epoch??"first");
    if(epoch===seenEpoch)return;
    seenEpoch=epoch;
    register();
  });
  register();
  return {dispose(){
    if(disposed)return;disposed=true;unsubscribe();
    events.emit("pi-intellisense:unregister:v1",{sessionId,extensionId:"pi-intellisense"});
  }};
}
