import { normalizeLocations } from "./locations.mjs";
export function createNavigationController({lsp,neovim,getGeneration=()=>0,getSnapshot=()=>null,report=()=>{}}){
  let serial=0,disposed=false;
  async function operation(kind,selection) {
    if(disposed)return;
    const token=++serial, generation=getGeneration();
    try {
      const response=await (lsp[kind] ? lsp[kind](selection) : lsp.query({...selection,kind}));
      if(disposed || token!==serial || getGeneration()!==generation)return;
      if(kind==="hover"){report({type:"hover",value:response});return response;}
      const targets=normalizeLocations(response);
      if (!targets.length){report({type:"info",message:"No "+kind+" target"});return;}
      if (targets.length>1){report({type:"locations",kind,items:targets});return targets;}
      await neovim.open(targets[0]);
    } catch(error){if(!disposed)report({type:"error",error});throw error;}
  }
  return {hover:x=>operation("hover",x),definition:x=>operation("definition",x),
    references:x=>operation("references",x), dispose(){disposed=true;serial++;}};
}
