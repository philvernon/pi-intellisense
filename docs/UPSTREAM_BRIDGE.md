# pi-tab-focus upstream integration patch plan

**Status:** IMPLEMENTED IN LOCAL CHECKOUT. The bridge was patched into `~/dev-trash/pi-tab-focus/src/index.ts` and passes that repository's 67 tests and typecheck. The installed npm `pi-tab-focus` v1.0.2 remains unmodified, so the bundled wrapper loads the patched local checkout explicitly. Production npm release/upstream publication and final Sidekick integration are outstanding. Canonical semantics: [../SPEC.md](../SPEC.md) and [../TEST_CONTRACT.md](../TEST_CONTRACT.md).

## Files and patch boundaries (implemented P0; broader mapping still needed)

1. **`src/vim-navigation.ts`:** extend `VimVisualNavigation.handleKey`'s existing pending `g` grammar with `gd`, `gD`, `gi`, `gy`, `gr`, `gs` while preserving `gg`, `ge`, `gE`, `f/F/t/T`, `v/V`, `y/c` and count behaviour. `K` maps to hover **only when visual mode has a code-symbol cursor and a registered action**. The **item-focus** `K` in `src/index.ts` must retain previous-item navigation.
2. **`src/transcript-observer.ts`:** augment `TranscriptItem` metadata with stable session entry/content-part/code-block identifiers and renderer-relative code spans, not just aggregated stripped message text. Preserve original code text, file provenance candidate, display line-wrap and cell mapping. Source positions must be proven by file contents and version, not filename prose. Do not infer LSP positions by stripping ANSI and trusting display widths.
3. **`src/fullscreen-layout.ts`:** expose a safe `absolute transcript visual cursor → terminal screen row,col` projection respecting primary scroll view, transcript top offset, viewport bounds and chrome/prompt rows. Invalidate on resize/reflow, tool folding/expansion, mode switch and cursor leaving viewport. Pi TUI overlays take terminal-relative absolute `row` and `col`.
4. **`src/index.ts`:** register Pi event-bus listeners and emit availability on session start. *The existing tab-focus raw input hook remains the sole native transcript key owner.* Freeze a versioned `FocusSnapshotV1` at dispatch. Do not install a rival `onTerminalInput` listener in pi-intellisense. When another Pi overlay/menu/EX mini-mode has focus, yield input. Clean all bridge callbacks and source-region caches on shutdown/reload.
5. **`src/tests/`:** add focused coverage for visual `K`, `gd` and legacy motions, visual scroll/cursor projection, overlay focus handoff, load order/duplicate handlers, snapshots and invalidated regions. Port or import the portable `test/native/focus-bridge.contract.test.mjs` harness from pi-intellisense.

## Event handshake v1 (target; current consumer needs migration)

```ts
type Registration = {
  sessionId: string;
  extensionId: "pi-intellisense";
  actions: string[];
  invoke(action: string, snapshot: FocusSnapshotV1): Promise<void>;
};

type FocusSnapshotV1 = {
  version: 1;
  sessionId: string;
  itemSemanticKey: string;
  itemKind: "message" | "tool" | "prompt" | "custom";
  transcriptRevision: string;
  layoutRevision: string;
  visualCursor: {row:number;col:number};  // absolute transcript cells
  screenCursor: {row:number;col:number};  // actual terminal cells
  selectedCodeRegionId: string | null;
  sourceSpans: readonly VerifiedDisplaySpan[];
};
```

Events: `pi-intellisense:register:v1`, `pi-intellisense:unregister:v1`, `pi-tab-focus:availability:v1`. Scope every event by Pi session, include `bridgeVersion:1` with availability, make duplicate registration idempotent and support either extension loading first. The bridge invokes the registered handler asynchronously and catches rejection without eating unrelated Pi keystrokes.

**Migration completed:** `src/bridge/register.ts` now emits extension ID/action list and accepts the new native snapshot. `src/index.ts` routes to `src/native/native-controller.ts`, not the old `/intel` view. `src/native/live-source.ts` currently maps strict file-backed source lines using displayed path hints; fuller renderer-span metadata and virtual documents remain enhancements. Existing tests are baseline only, not evidence of working native integration.

## Native hover/picker behaviour

When the user presses `K` over an identified code symbol, resolve `SourceAnchor` through the project-backed or virtual-document policy, call real LSP hover, then use **`ctx.ui.custom(..., {overlay:true, overlayOptions:{row,col,width,maxHeight}})`**, positioned near the visible symbol. Do not call the separate `openCodePane`, `ctx.ui.setEditorComponent` or open a second code viewer. `Esc` closes just the overlay, returning to exactly the same transcript cursor, selection and scroll position. Any late LSP result after session/selection/layout invalidation is ignored.

`gd` and `gr` resolve locations through LSP; multiple targets use a similarly transient overlay picker. Validated definition is sent over structured Msgpack-RPC to an *existing* Neovim server.

## Sidekick and pi-tools

User environment verified: Neovim config `~/dotfiles-stow/nvim/.config/nvim/lua/user/plugins/sidekick.lua`, local `~/dev-trash/pi-tools/lua/pi-sessions/sidekick.lua` (not `~/dev/repos/pi-tools`), Sidekick session backed by `tmux -L agents`. Pi's TUI stays inside that Neovim terminal buffer; Neovim LSP cannot directly hover symbols in its plain terminal contents. Prefer a configured `nvim --listen` socket, since `$NVIM` may not be present in resumed/detached tmux sessions. No `pi-tools` change unless manual integration proves it necessary.

## Upstream acceptance

`Tab → v → K` displays a floating LSP signature/docs rectangle over the **original transcript**. `Esc` dismisses it without changing item/viewport/yank; `gd` navigates safely in existing Neovim; legacy keys continue working. Run `npm run test:native` in pi-intellisense and upstream tab-focus tests; manually validate Pi 1.3.0 fullscreen+pi-vim+Sidekick using a real TS server and source snippet.

The required local upstream patch and a real Pi + TypeScript language server + Neovim socket PTY hover/definition smoke test have now been completed. Full Sidekick/tmux and release packaging checks remain outstanding.
## V2 focus ownership patch

Patched local tab-focus emits immutable snapshot data and a synchronous `isCurrent()` predicate that checks current item, cursor, focus epoch, transcript version and viewport. The IntelliSense controller uses it to suppress late responses. Pressing Tab in the capturing hover component closes the popup and publishes `pi-intellisense:return-to-editor:v1` with the session ID; tab-focus then exits its visual/transcript mode and returns TUI focus to the prompt editor. Escape closes only the popup. Ending visual mode also clears any pending `g` prefix so future keys cannot be misinterpreted after focus switches. See the 70 passing local upstream tests.

This still leaves the installed npm `pi-tab-focus` distribution separate from the patched local checkout. The compatibility wrapper loads the local checkout directly. For the complete v2 roadmap consult [REFACTOR_PLAN.md](REFACTOR_PLAN.md).