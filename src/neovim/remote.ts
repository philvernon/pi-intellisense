import path from "node:path";
import {fileURLToPath} from "node:url";
import {lspToNvimByteColumn} from "../positions.mjs";
import {within} from "../locations.mjs";
const LUA=[
  "local filename, line, col = ...",
  "vim.cmd.edit(vim.fn.fnameescape(filename))",
  "vim.api.nvim_win_set_cursor(0, {line, col})",
  "return true"
].join("\n");
export function createNeovimGateway({socket,roots,rpc,readFile}:{
  socket?:string;roots:string[];
  rpc:{execLua:(code:string,args:any[])=>Promise<unknown>};
  readFile:(path:string)=>Promise<string>;
}) {
  return {async open({uri,line,character}:{uri:string;line:number;character:number}){
    if(!socket)throw new Error("Neovim server socket unavailable");
    if(typeof uri!=="string"||!uri.startsWith("file://"))throw new Error("Unsupported file URI scheme");
    const location=fileURLToPath(uri);
    if(!roots.some(r=>within(path.resolve(r),path.resolve(location))))
      throw new Error("Location outside trusted roots");
    if(!Number.isSafeInteger(line)||line<0||!Number.isSafeInteger(character)||character<0)
      throw new RangeError("Invalid source cursor");
    const content=await readFile(location);
    const text=content.split(/\r?\n/u)[line];
    if(text===undefined)throw new RangeError("Line out of range");
    const col=lspToNvimByteColumn(text,character);
    await rpc.execLua(LUA,[location,line+1,col]);
  }};
}