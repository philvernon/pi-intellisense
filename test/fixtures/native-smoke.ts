import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
export default function(pi:ExtensionAPI){
 pi.registerCommand("smoke-intel",{
  description:"Inject a known file-backed snippet into the original Pi transcript, without a model request",
  handler:async()=>{
   pi.sendMessage({
    customType:"native-intellisense-smoke",
    display:true,
    content:"NEW · test/fixtures/source.ts\n\n```ts\nconst café = \"😃\";\nexport function greet(name: string): string {\n  return `hello, ${name}`;\n}\ngreet(café);\n```"
   });
  }
 });
}
