type Snapshot = {
  version:number;sessionId:string;semanticKey:string;kind:string;sourceRevision:number;
  visualCursor:{row:number;col:number}|null
};
export function registerTabFocusIntelliSense({events,sessionId,onAction}:{
  events:{on:(event:string,fn:(payload:any)=>void)=>()=>void;emit:(event:string,payload:any)=>void};
  sessionId:string; onAction:(operation:string,snapshot:Snapshot)=>Promise<void>;
}){
  let disposed=false, availabilitySeen=false;
  const invoke=async(operation:string,snapshot:Snapshot)=>{
    if(disposed)throw new Error("IntelliSense session disposed");
    if(snapshot?.version!==1||snapshot.sessionId!==sessionId||
      typeof snapshot.semanticKey!=="string"||
      !snapshot.visualCursor || !Number.isInteger(snapshot.visualCursor.row)||
      !Number.isInteger(snapshot.visualCursor.col))
      throw new Error("Invalid or stale IntelliSense session snapshot");
    return onAction(operation,snapshot);
  };
  const register=()=>events.emit("pi-intellisense:register:v1",{sessionId,invoke});
  const unsubscribe=events.on("pi-tab-focus:availability:v1",(payload:any)=>{
    if(disposed||payload?.sessionId!==sessionId||availabilitySeen)return;
    availabilitySeen=true;register();
  });
  register();
  return {dispose(){if(disposed)return;disposed=true;unsubscribe();
    events.emit("pi-intellisense:unregister:v1",{sessionId});}};
}