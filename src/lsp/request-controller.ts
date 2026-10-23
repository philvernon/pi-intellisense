export function createLatestRequestController(){
  let current:AbortController|undefined;let generation=0,disposed=false;
  return {
    async run<T>(job:(signal:AbortSignal)=>Promise<T>):Promise<T|undefined>{
      if(disposed)return undefined;
      current?.abort();const id=++generation;
      const controller=new AbortController();current=controller;
      try {const value=await job(controller.signal);
        if(disposed||controller.signal.aborted||id!==generation)return undefined;
        return value;
      }catch(error){
        if(disposed||controller.signal.aborted||id!==generation)return undefined;
        throw error;
      }
    },
    dispose(){disposed=true;generation++;current?.abort();current=undefined;}
  };
}