export interface GestureContext {
  mode:"visual"|"item"|"editor";
  cursor?:{row:number;col:number};
  popupFocused?:boolean;
  enabled?:boolean;
}
const simple:Record<string,string> = {
  K:"hover", gd:"definition",gD:"declaration",gi:"implementation",
  gy:"typeDefinition",gr:"references",gs:"documentSymbols",
  "[d":"previousDiagnostic","]d":"nextDiagnostic",
  "ctrl+k":"signatureHelp","ctrl+space":"completion"
};
export function parseSemanticGesture(keys:readonly string[],ctx:GestureContext):
  {consumed:boolean;pending?:boolean;operation?:string} {
  if(ctx.mode!=="visual"||!ctx.cursor||ctx.popupFocused||ctx.enabled===false)
    return {consumed:false};
  if(keys.length===1&&["g","[","]"].includes(keys[0]))
    return {consumed:true,pending:true};
  const operation=simple[keys.join("")];
  return operation?{consumed:true,operation}:{consumed:false};
}