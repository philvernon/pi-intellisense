# Implementation and acceptance contracts

**Implemented 23 October 2026.** [SPEC.md](SPEC.md) is authoritative. Native Pi-transcript hover and definition now work through the locally patched `~/dev-trash/pi-tab-focus`. The npm-distributed copy is not yet patched. The native contracts and local tab-focus integration tests are green; live Pi/TypeScript/Neovim smoke testing has also passed.

## 1. Existing implementation (GREEN regression suite)

The existing modules are implemented and tested:

- `src/blocks.mjs`: finalized fenced Markdown extraction
- `src/provenance.mjs`, `src/positions.mjs`, `src/locations.mjs`: file-verified matching, text offsets and destination safety
- `src/lsp.mjs`, `src/lsp-stdio.mjs`, `src/runtime.mjs`: LSP transport and lifecycle
- `src/neovim.mjs`, `src/neovim-rpc.mjs`, `src/msgpack.mjs`: structured Neovim remote navigation
- `src/bridge/register.ts`, `src/bridge/gestures.ts`: earlier **partial** integration contracts; they do not bind keys in the installed `pi-tab-focus`
- `src/index.ts`, `src/ui/code-pane.ts`: standalone `/intel` view (transitional only)

`npm test` runs `test/*.test.mjs` for legacy behaviour. Those tests **do not prove native transcript hover or go-to-definition**.

## 2. Native integration APIs (implemented contract suite)

The following module paths/exports are implemented in this repo. The `pi-tab-focus` adapter is also reflected in the locally patched `~/dev-trash/pi-tab-focus/src/index.ts`. Tests in `test/native/*.test.mjs` pass, but the installed npm `pi-tab-focus` remains unchanged. Tests may be moved into the upstream `pi-tab-focus` project when the patch is committed or published. The new native host/source mapping uses additional `src/native/live-source.ts` and the `src/index.ts` entrypoint.

### 2.1 `src/native/tab-focus-adapter.ts` — upstream reference/harness

```ts
createTabFocusNativeBridge({
  events: { on(event, listener): unsubscribe; emit(event, payload): void },
  getFocus(): FocusState,
  legacyHandleKey(key: string): { handled: boolean, owner: string }
}): {
  handleKey(key: string): Promise<{handled: boolean}> | {handled: boolean};
  dispose(): void;
}
```

**Production ownership:** port functionality to `philvernon/pi-tab-focus` `src/index.ts` and `src/vim-navigation.ts`; do not actually install a second raw terminal key listener in `pi-intellisense`. `getFocus()` returns mode, `sessionId`, visual cursor, item identity, layout/transcript revisions, `screenCursor`, selection and transient-overlay state. The adapter must only consume subscribed gestures when a visual cursor points to a code token and the transcript is the focused surface.

Bridge events use:

```ts
type FocusSnapshotV1 = {
  version: 1;
  sessionId: string;
  itemSemanticKey: string;
  itemKind: string;
  transcriptRevision: string;
  layoutRevision: string;
  visualCursor: {row:number; col:number};   // absolute transcript row/cell
  screenCursor: {row:number; col:number};   // terminal-relative
  selectedCodeRegionId: string | null;
  sourceSpans: readonly VerifiedDisplaySpan[];
};
```

`pi-intellisense:register:v1` = `{sessionId,extensionId:"pi-intellisense",actions,invoke(action,snapshot)}`; unregister and availability messages as defined in `SPEC.md §3`. Load order/hot reload cannot duplicate callbacks. `K` in item mode retains previous-item action. In visual mode `gd` is a two-key semantic operation, while `gg`/`ge`/`gE` and yank remain legacy motions. All modal/transient editor input belongs to Pi.

### 2.2 `src/native/overlay-geometry.ts` and `src/native/inline-hover.ts`

```ts
projectTranscriptCursor({
  cursor: {row,col},                  // absolute transcript
  viewport: {scrollTop,top,left,height,width},
  terminal: {rows,cols}
}): {row,col} | null;

placeHoverOverlay({
  anchor: {row,col},                 // terminal-relative anchor
  tooltip: {width,height},
  terminal: {rows,cols},
  protectedRows: {top,bottom}
}): {row:number;col:number;width:number;maxHeight:number;anchor?:string};

showInlineHover({
  ui, snapshot: FocusSnapshotV1,
  markup: string, geometry: {terminal,protectedRows},
  focusState?: unknown
}): Promise<void>;
```

Must call **`ui.custom(factory, {overlay:true,overlayOptions:{row,col,width,maxHeight}})`**, not `openCodePane`, `setEditorComponent` or any new transcript renderer. Escape closes only the overlay and leaves the existing transcript focus/cursor/yank/viewport unchanged. Offscreen anchor must not create a tooltip.

### 2.3 `src/native/transcript-source.ts`

```ts
resolveTranscriptSymbol({
  snapshot: FocusSnapshotV1,
  regions: readonly VerifiedCodeRegion[],
  source: { readFile(uri: string): Promise<string> }
}): Promise<{
  uri: string;
  position: {line:number;character:number};
  fileHash: string;
  token: string;
} | null>;

createVirtualCodeDocument({
  sessionId,codeRegionId,code,languageId
}): {uri:string;languageId:string;virtual:true;readOnly:true;canNavigateWithoutVerifiedTarget:false};
```

`VerifiedCodeRegion` is identified by Pi session item/part/fence and includes exact original code lines, `fileUri`, verified `fileHash`, display row/cell bounds, source line/UTF-16 character base, transcript revision and layout revision. `resolveTranscriptSymbol` identifies the *actual identifier under cursor*, respecting grapheme widths and wrapping. Returns null on gutter, whitespace, ambiguous anchor, revision mismatch, changed file, partial stream or unverified assistant hint. Virtual documents allow optional local hover; they do not imply an actual source destination.

### 2.4 `src/native/native-controller.ts`

```ts
createNativeTranscriptController({
  ui, lsp: {query(request): Promise<unknown>},
  neovim: {open(location): Promise<void>},
  resolveSymbol(snapshot): Promise<SourceAnchor | null>,
  getSession(): {sessionId:string;transcriptRevision:string}
}): {
  invoke(action: LspAction, snapshot: FocusSnapshotV1): Promise<void>;
  dispose(): void;
};
```

`invoke("hover")` requests `textDocument/hover` and opens only the positioned overlay. `invoke("definition")` resolves `Location/LocationLink`, validates targets, sends a single safe destination to the Neovim adapter and shows an **overlay picker** if several targets exist. No model message, prompt mutation or separate editor viewer. Late results from different session/revision are ignored; overlay must be cancellable. One invocation per key action.

### 2.5 `src/native/neovim-host.ts`

```ts
resolveNeovimHost({
  config:{socket?:string;focusPolicy?:string},
  env:{NVIM?:string;TMUX?:string},
  sidekick:{backend:"tmux";tmuxServer:"agents"}
}): {socket:string;focusPolicy:"preserve";spawnEditor:false} | null;

createNeovimHandoff({
  socket,connect,focusPolicy:"preserve",focusHost?,spawn?
}): {open(location):Promise<void>};
```

Must work with the user's `~/dev-trash/pi-tools` Sidekick `tmux -L agents` integration. Explicit socket wins; never assume `NVIM` survives tmux. Existing Neovim Msgpack-RPC receives structured path/line/byte-column data. No nested Neovim, new tmux instance or automatic host focus theft.

## 3. Running tests

```sh
npm test               # existing GREEN implementation regressions
npm run test:native     # new RED native contract tests
npm run test:all        # both; RED until actual native feature is implemented
npm run build           # existing entrypoint import and syntax checks
```

Native test IDs NT-01..NT-10 now pass. See [docs/TEST_PLAN.md](docs/TEST_PLAN.md). There must eventually be real Pi/TTY and `pi-tab-focus` integration coverage in addition to the current fakes.

## 4. Definition of done

- Pressing `Tab → v → K` on a symbol in the **original Pi transcript** displays an on-symbol floating LSP tooltip. `Esc` dismisses only the tooltip.
- Pressing `gd` in the same transcript jumps to the source using the existing Neovim server.
- Native `pi-tab-focus` motions and yank are unaffected.
- Source positions are verified and correct; unsafe/unknown targets never open.
- Native automated tests and a real Pi+Neovim+Sidekick E2E test are green.

The original Pi transcript `K` hover and `gd` jump were exercised in a live local PTY with a real TypeScript language server and headless Neovim. Still verify Sidekick/tmux, alternate languages and text-wrapping edge cases.