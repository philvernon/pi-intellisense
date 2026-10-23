# Planned production contracts consumed by RED tests

These exports **do not currently exist**. They are the smallest observable interfaces the implementation must satisfy; adjust test and SPEC together if real Pi API study requires a change.

```ts
// src/bridge/gestures.ts
type Context = { mode:"visual"|"item"|"editor"; cursor?: {row:number;col:number}; popupFocused?:boolean; enabled?:boolean };
parseSemanticGesture(keys:readonly string[], context:Context): {consumed:boolean; pending?:boolean; operation?:string};

// src/provenance/coordinates.ts
displayColumnToUtf16(renderedLine:string, displayColumn:number, options?:{tabSize?:number}): number | undefined;
utf16ToUtf8ByteColumn(sourceLine:string, utf16Offset:number): number;

// src/provenance/read.ts
mapReadResult(arg:{
  path:string; readText:string; fileText:string; itemSemanticKey:string;
  renderedStartRow:number;
}): {spans:Array<{displayRow:number;displayColStart:number;displayColEnd:number;anchor:{
  sourceUri:string;sourceStart:{line:number;character:number};origin:string
}}>} | null;

// src/provenance/source-map.ts
resolveSourceAtCursor(arg:{
  spans:Array<DisplaySpan>; cursor:{row:number;col:number};
  expectedRevision?:string; currentRevision?:string;
}): SourceAnchor | null;

// src/lsp/normalize.ts
normalizeLocations(value: null | Location | Location[] | LocationLink[]): Array<{uri:string;line:number;character:number}>;
normalizeHover(value: unknown): {markdown:string} | null;

// src/lsp/request-controller.ts
createLatestRequestController(): {run<T>(job:(signal:AbortSignal)=>Promise<T>):Promise<T | undefined>; dispose():void};

// src/neovim/remote.ts
createNeovimGateway({
  socket:string|undefined, roots:string[], rpc:{
    execLua(code:string,args:any[]):Promise<unknown>
  }, readFile(path:string):Promise<string>
}): {open({uri,line,character}:{uri:string;line:number;character:number}):Promise<void>};
```

Bridge event contracts and method support are in SPEC sections 2, 3, 5 and 7. The production implementation can use a different internal decomposition but MUST maintain these black-box behaviors or deliberately migrate the tests and documentation in the same commit.

Fixture conventions: all LSP line/character numbers zero-based, UTF-16 unless noted. Transcript row/column numbers zero-based, display cells, not JS string indices. Neovim API row is one-based and byte column zero-based. `LocationLink.targetSelectionRange` overrides `targetRange` for jump position.

Test suite outcome in this phase: failing module imports are **expected RED**, not evidence of successfully tested functionality. Actual runtime Pi/Neovim integration is not tested by Node mocks alone.
Additional bridge and command orchestration contracts:

```ts
// src/bridge/register.ts
registerTabFocusIntelliSense({
  events: {on(event:string,handler:(payload:any)=>void):()=>void; emit(event:string,payload:any):void},
  sessionId:string,
  onAction:(operation:string,snapshot:FocusSnapshotV1)=>Promise<void>
}): {dispose():void};

// src/controller.ts (no dependency on Pi's model invocation)
createIntelliSenseController({
  sourceAtCursor:(snapshot:FocusSnapshotV1)=>Promise<SourceAnchor|null>,
  lsp: { query(request:any):Promise<any> },
  neovim: { open(location:any):Promise<void> },
  ui: { showHover(markdown:string):void; showError(message:string):void; selectLocation?(items:any[]):Promise<any> }
}): {run(operation:string,snapshot:FocusSnapshotV1):Promise<void>; dispose():void};
```

The bridge emits `pi-intellisense:register:v1` with `{sessionId,invoke}`; repeated `pi-tab-focus:availability:v1` must not create duplicate bindings, and dispose emits `pi-intellisense:unregister:v1`. `FocusSnapshotV1` is frozen/versioned, cursor and semantic item identity are mandatory. Execution paths never send a user message or call an LLM.
