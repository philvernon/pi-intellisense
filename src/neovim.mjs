import { lspToNvimByteColumn } from "./positions.mjs";
import { promises as fsDefault } from "node:fs";
const LUA = [
  "local path, line, bytecol = ...",
  "vim.cmd.edit(vim.fn.fnameescape(path))",
  "vim.api.nvim_win_set_cursor(0, {line, bytecol})",
  "return true"
].join("\n");
/** Go to source via structured Neovim Msgpack-RPC. Never shell-interpolate paths. */
export async function openInNeovim({location,socket,rpc,fs=fsDefault,signal=/** @type {AbortSignal | undefined} */ (undefined),isCurrent=/** @type {() => boolean | Promise<boolean>} */ (()=>true)}) {
  const current=async()=>!signal?.aborted && await isCurrent() && !signal?.aborted;
  if (!await current() || signal?.aborted) return;
  if (!socket || typeof socket!=="string") throw new Error("No Neovim server socket configured");
  if (!location?.path || !Number.isSafeInteger(location.line) || location.line<0)
    throw new RangeError("invalid destination line");
  const content=await fs.readFile(location.path,"utf8");
  if (!await current() || signal?.aborted) return;
  const lines=content.split(/\r?\n/u), target=lines[location.line];
  if(target===undefined)throw new RangeError("destination line out of range");
  const column=lspToNvimByteColumn(target,location.character,location.encoding??"utf-16");
  if (!await current() || signal?.aborted) return;
  await rpc.request("nvim_exec_lua",[LUA,[location.path,location.line+1,column]]);
  return {path:location.path,line:location.line+1,column};
}
