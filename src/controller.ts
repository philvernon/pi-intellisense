import {normalizeLocations,normalizeHover} from "./lsp/normalize.ts";
export function createIntelliSenseController({sourceAtCursor,lsp,neovim,ui}:any) {
  let disposed=false;
  async function run(operation:string,snapshot:any) {
    if(disposed)return;
    try {
      const anchor=await sourceAtCursor(snapshot);
      if(!anchor||anchor.confidence!=="verified"){
        ui.showError("No verifiable source mapping for code under cursor");
        return;
      }
      const result=await lsp.query({kind:operation,uri:anchor.sourceUri,
        position:anchor.sourceStart,documentVersion:anchor.sourceVersion});
      if(disposed)return;
      if(operation==="hover") {
        const hover=normalizeHover(result);
        if(hover)ui.showHover(hover.markdown);
        else ui.showError("No LSP hover information");
        return;
      }
      const items=normalizeLocations(result);
      if(!items.length){ui.showError("No "+operation+" target");return;}
      const chosen=items.length===1?items[0]:await ui.selectLocation?.(items);
      if(chosen&&!disposed)await neovim.open(chosen);
    }catch(error){if(!disposed)ui.showError(String(error));}
  }
  return {run,dispose(){disposed=true;}};
}