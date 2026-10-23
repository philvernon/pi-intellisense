import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
export default function(pi:ExtensionAPI){
 pi.registerCommand("smoke-virtual",{
  description:"Show a read-only generated TS code snippet in original transcript",
  handler:async()=>{
    pi.sendMessage({
      customType:"native-intellisense-virtual-smoke",
      display:true,
      content:"Generated example:\n\n\x60\x60\x60ts\nfunction localThing(x: number): number { return x * 2; }\nlocalThing(4);\n\x60\x60\x60"
    });
  }
 });
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