export function resolveNeovimHost({config={},env={},sidekick}:any) {
 const socket=config.socket ?? env.NVIM;
 if(typeof socket!=="string"||!socket.startsWith("/"))return null;
 return {socket,focusPolicy:config.focusPolicy??"preserve",spawnEditor:false};
}
export function createNeovimHandoff({socket,connect,focusPolicy="preserve",focusHost,spawn}:any) {
 return {async open(location:any){
   if(!socket)throw new Error("No Neovim socket configured");
   const client=await connect(socket);
   try{await client.open(location);}finally{await client.close?.();}
 }};
}
