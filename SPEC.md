# Pi IntelliSense — native transcript integration specification

**Status (23 October 2026):** Native Pi-transcript hover and definition are now implemented in this repository plus the **local patched** `~/dev-trash/pi-tab-focus` checkout. Both suites pass, and a live Pi 1.3.0 fullscreen + TypeScript LSP + Neovim RPC smoke test demonstrated the original transcript `K` tooltip and `gd` jump. The installed npm `pi-tab-focus` 1.0.2 is **not** patched and the user's Sidekick/tmux setup has not yet been fully tested. The existing `/intel` viewer remains a transitional fallback.

**Verified runtime:** Pi 1.3.0 fullscreen, locally patched `pi-tab-focus` 1.0.1 (the npm 1.0.2 copy remains unmodified), TypeScript language server with TypeScript 5.9 and Neovim remote socket. Target includes the user's `pi-vim` and Neovim/Sidekick stack, which still require manual integration checks. No `pi-tools` changes were made.

## Implementation locations

- `src/native/live-source.ts`: resolves original transcript rendered lines to exact file-backed symbols when a valid project-relative filename is present and the current source text matches; rejects missing or ambiguous mappings.
- `src/native/native-controller.ts`: invokes LSP requests, cancels stale results and routes hover/navigation without invoking the model or opening `/intel`.
- `src/native/inline-hover.ts` and `overlay-geometry.ts`: use Pi's real `ctx.ui.custom(...,{overlay:true})`, with `row`/`col` beside the transcript cursor.
- `src/bridge/register.ts` and `src/index.ts`: register the event bus handler and supply the real LSP/Neovim adapters.
- `~/dev-trash/pi-tab-focus/src/index.ts` (local modified checkout): owns the visual cursor, dispatches `K`/`gd` and other `g` actions and produces the session/item/display snapshot. The patch is reproducible with `scripts/patch-tab-focus.mjs`.
- `bin/pi-intellisense`: launches the two local extensions together.

**Known constraint:** code must have a resolvable file path in the transcript item (or supported structured tool path) and a matching current source line. Virtual unsaved-code document support exists as a contract helper but is not yet wired into the full live LSP backend. Very long wrapped lines and advanced Sidekick focus cases need further testing.

## 1. User-visible contract (the product)

The **original Pi chat transcript is the code viewer**. Do not copy a message into a second pane, replace the transcript with an editor buffer or require `/intel`.

1. In fullscreen Pi, press `Tab` to focus the transcript using existing `pi-tab-focus`.
2. Navigate to an existing assistant/message/tool code block with normal transcript navigation. Press `v` to enter its existing character-level visual cursor and use `h/j/k/l`, `w/b` etc to put the cursor on a symbol.
3. Press `K`. An **LSP hover tooltip appears in place, overlapping the transcript close to that symbol** (like an editor's hover), not a full-screen or independent code viewer. It shows the resolved signature/type and LSP documentation. If LSP cannot resolve it, show an unobtrusive, precise reason.
4. Press `Esc` to dismiss **only** that tooltip. Exactly the same transcript item, viewport and visual cursor remain selected. Continue navigating, selecting and yanking with the existing extension.
5. Press `gd` on a resolvable symbol. Query `textDocument/definition`. A unique safe file location opens in the existing Neovim instance at the correct byte column; multiple targets open a **transient overlay picker over the transcript**, then open Neovim.
6. Hover and definition are **local UI + LSP actions**. Neither must send a new message, invoke a model, modify source code or convert the underlying Pi transcript into another UI.
7. Running Pi from a `folke/sidekick.nvim` terminal hosted by `pi-tools` must continue to work. Sidekick does not make the terminal's transcript a Neovim LSP buffer; Pi still renders and owns it.

A tooltip like the user-supplied sketch is the primary acceptance image: symbol under the `pi-tab-focus` cursor, floating type/docs rectangle, unmodified transcript visible underneath.

### P0 keyboard and modes

| Mode | Key | Required behaviour |
|---|---|---|
| Editor input | `Tab` | Existing tab-focus entry, no new IntelliSense capture |
| Transcript item focus | `K` | **Keep existing previous-item navigation** |
| Transcript item focus | `g`, `y`, `Enter`, `j/k` | Keep current scroll/copy/link semantics |
| Transcript item focus | `v` | Enter existing `VimVisualNavigation`; cursor visible |
| Transcript visual cursor on symbol | `K` | Inline hover overlay |
| Transcript visual cursor on symbol | `gd` | Definition → safe Neovim location |
| Transcript visual cursor | `gg`, `ge`, `gE`, `f/F/t/T`, `v/V`, `y/c` | Preserve existing motions/selection/yank |
| Hover overlay | `Esc` | Close only overlay and restore underlying cursor/viewport |
| Definition picker | `j/k`, `Enter`, `Esc` | Select safely or dismiss without navigating |
| Prompt, transient menu, EX detour, non-fullscreen mode | IntelliSense keys | **Not captured** by native transcript integration |
| Plugin absent or unable to map symbol | `K` / `gd` | Clear no-result/no-mapping status; never silently open an unrelated file |

P1: `gr` references, `gD` declaration, `gi` implementation, `gy` type definition, `gs` symbols, `[d`/`]d` diagnostics. P2: signature help, read-only completion candidates, pointer hover. Retain `pi-tab-focus` default keys when no IntelliSense handler is registered.

### Invariants

- **No separate /intel panel** in the native `K`/`gd` path, ever. `/intel` can temporarily remain an opt-in debugging fallback but is not a completion criterion.
- No loss of native transcript scroll position, focus mode, item identity, existing selection or yank. No prompt input leakage.
- No source assumptions inferred solely from an AI message, syntax-colour escape sequences, filename prose or GitHub links.
- No source editing, command execution through hover text or arbitrary external URI navigation.
- UI overlay remains in the same Pi fullscreen TUI. Neovim handoff occurs **only** for navigation, not for hover.

## 2. Concrete integration points, verified in installed Pi

Current `pi-tab-focus` package (npm v1.0.2):
- `src/index.ts`: registers `ctx.ui.onTerminalInput` before editor input, tracks `focused`, `visualNavigation` and layout, guards transient components through `transientUiHasFocus`, enters visual mode with `v`, and invokes `VimVisualNavigation.handleKey` from `handleVisualInput`.
- `src/vim-navigation.ts`: `VimVisualNavigation.snapshot().head` is an absolute **rendered transcript** `{row,col}` using terminal cell columns. The `g` pending grammar already owns `gg`, `ge`, `gE`. Integrate semantic keys into this grammar instead of a second raw-key listener.
- `src/transcript-observer.ts`: `TranscriptRenderObserver` supplies item identity, kind, boundaries, rendered lines and geometry. It does **not** currently supply a lossless source-file map.
- `src/fullscreen-layout.ts`: `FullscreenLayoutController` can inspect fullscreen layout/primary scroll view. Some paths rely on private Pi structures and need version compatibility tests.

Pi 1.3.0's `@earendil-works/pi-tui` OverlayOptions supports `row` and `col` **in terminal-relative absolute coordinates**, `width`, `maxHeight`, `anchor` and margins. `ctx.ui.custom(factory,{overlay:true,overlayOptions:{row,col,width,maxHeight}})` uses these positions. `ctx.ui.custom` **without `overlay:true` is not acceptable for native hover**. Overlay `Esc` is handled by the overlay component. `ctx.ui.custom` renders from Pi, and Pi restores underlying UI on dismissal.

**Separate codebases, one owner per concern:**
- **`pi-tab-focus` (upstream patch)**: owns keyboard grammar and visual cursor; assembles the immutable, source-aware `FocusSnapshot`, resolves cursor-to-viewport geometry and delegates semantic gestures to an installed handler.
- **`pi-intellisense` (this repo)**: event-bus registration and lifecycle, provenance validation, source mapping/virtual doc policy, LSP queries, hover/picker overlays and Neovim RPC.
- **`pi-tools` / Sidekick**: existing Neovim-hosted terminal/tmux integration. No transcript rendering, keyboard or LSP changes planned here.

## 3. Versioned bridge protocol

Use Pi extension event bus for registration, rather than competing `onTerminalInput` listeners.

```ts
type LspAction = "hover" | "definition" | "references" | "declaration" |
  "implementation" | "typeDefinition" | "documentSymbols" |
  "previousDiagnostic" | "nextDiagnostic" | "signatureHelp" | "completion";

interface FocusSnapshotV1 {
  version: 1;
  sessionId: string;
  itemSemanticKey: string; // stable identity for currently visible message/tool item
  itemKind: "message" | "tool" | "prompt" | "custom";
  transcriptRevision: string; // changes on re-render/stream/branch change
  layoutRevision: string; // width/reflow/scroll/layout identity
  visualCursor: { row: number; col: number }; // absolute transcript row / terminal cell col
  screenCursor: { row: number; col: number }; // terminal-relative, validated onscreen
  selectedCodeRegionId: string | null;
  sourceSpans: readonly VerifiedDisplaySpan[]; // or separate resolver handle
}
interface RegistrationV1 {
  sessionId: string;
  extensionId: "pi-intellisense";
  actions: readonly LspAction[];
  invoke(action: LspAction, snapshot: FocusSnapshotV1): Promise<void>;
}
```

Events:
- `pi-intellisense:register:v1` with `RegistrationV1`;
- `pi-intellisense:unregister:v1` with `{sessionId,extensionId}`;
- `pi-tab-focus:availability:v1` with `{sessionId, bridgeVersion:1}`. The consumer retries registration **at most once per new availability epoch** to handle load order, hot reload and session switch without duplicate handlers.

A single `pi-tab-focus` input dispatcher evaluates whether it has a registered action. It captures `K`/`gd` only in **visual cursor mode**, with no other focused transient UI/EX mode. Dispatch freezes a snapshot at key time; no mutable TUI/component instances cross the bridge. The session ID, item identity, transcript revision, layout revision and source version are checked before rendering and before any navigation. Late/cancelled replies never change current UI. Swapping sessions or reloading unregisters listeners and closes overlays. A bridge protocol mismatch yields a status warning, not fallback key theft.

**Migration note:** current `src/bridge/register.ts` and `src/index.ts` implement an earlier partial event convention (`semanticKey`, `sourceRevision`, `codeRegions` and no authoritative on-screen coordinate). The revised schema above is the **target**; native tests must not pass solely by exercising that earlier stub.

## 4. Source hit testing, versions and virtual documents

The hard problem is projecting a displayed transcript symbol back to a meaningful language-server text document. A **visual terminal cell column is not an LSP UTF-16 character**. Two linked maps are required:

```
Pi session entry + content-part/code-block ID
  → original code text and provenance
  → verified source file URI + source line/column OR a virtual LSP document URI
  → rendered code row/column segments, wraps, indentation, markdown fences and escapes
  → active pi-tab-focus visual cursor cell
  → exact LSP position and source-version token
```

`VerifiedDisplaySpan` includes `itemSemanticKey`, `codeRegionId`, `displayRow`, terminal-cell `colStart/colEnd`, `fileUri`, UTF-16 `sourceStart/sourceEnd`, `fileHash` and `transcript/layoutRevision`. **A span covering a whole line is not enough to resolve an individual symbol**. Resolve the identifier under the cursor and its exact UTF-16 offset inside verified text. Stripped ANSI is not a reliable substitute for a renderer-level token mapping.

Evidence tiers:
1. **File-backed:** structured `read` tool call/result, trusted source entry or verified explicit binding; re-read current file, match original snippet exactly and disambiguate duplicates. Constrain paths via realpath to trusted roots; provenance must survive only while file hash and transcript layout version match.
2. **Diff-backed:** map context and added/removed side separately to the correct before/after snapshot, with hunk base lines. Never treat deleted code as the current after-file version.
3. **Assistant fenced snippet:** may map to a file only on an exact, unambiguous matching contiguous region. Merely displaying `src/x.ts` or a clickable GitHub link is not sufficient evidence.
4. **Virtual document for unbacked snippets:** on explicit supported language and server capability, optionally `didOpen` a read-only session-scoped URI to get hover/completion. Do not pretend this yields reliable workspace imports or a definition in the user's real source tree. Only allow `gd` if the server returns a validated, existing, trusted `file://` target. Otherwise display “No verifiable definition target”.
5. **Unknown mapping:** show a small status notification without a new editor/viewer. Never guess a string match across the repository.

Handle grapheme clusters, tabs, Unicode combining marks, emoji/wide glyphs, OSC8/ANSI styling, line-number gutters, CRLF, Markdown fence prefixes, soft wrapping, truncation and terminal resize. Reject ambiguous, stale or offscreen mapping. Cursor at whitespace or punctuation does not silently jump to a different token.

Cache keys must include session and item, file hash, transcript revision, layout revision, terminal width and source region. Revalidate source contents before LSP request **and again before Neovim RPC navigation**. Streaming, context compaction, tool expansion, folding, branch switches, viewport reflows and file changes invalidate as appropriate.

## 5. Hover overlay geometry and focus lifecycle

The overlay is anchored to **the rendered symbol, not the centre of the terminal**:

1. Convert absolute transcript position to a visible `screenCursor` using the current fullscreen scroll view, transcript origin and layout; ensure row/col fall inside viewport and are not under fixed Pi chrome/prompt.
2. Compute a bounded tooltip rectangle of width `min(configuredWidth,availableWidth)` and height `min(contentHeight,maxHeight,availableHeight)`, preferring below-right and flipping above/left near edges. Recompute on terminal resize or dismiss if the anchor becomes invisible.
3. Invoke `ctx.ui.custom(factory, {overlay:true, overlayOptions:{row,col,width,maxHeight}})` or the equivalent Pi TUI overlay API, returning a cancellable handle/promise. Do **not** call the existing `openCodePane` (`ctx.ui.custom` without overlay), overwrite the Pi editor or render a parallel transcript.
4. Render sanitized LSP MarkupContent/plaintext with Pi theme, a type/signature line, wrapped docs and scrollable content. No raw terminal control sequences/OSC52/hyperlinks with unsafe protocols.
5. While overlay is focused, `pi-tab-focus` yields input to it. `Esc` closes only the overlay; focus returns to the previous visual transcript cursor without resetting the transcript mode or selection. Other global Pi modals remain authoritative. `Tab` obeys the overlay's documented focus behaviour; never inserts prompt text.
6. Cancel/ignore late results on `Esc`, subsequent key requests, overlay close, tab-focus exit, resize if cursor becomes unmappable, Pi session switch and `session_shutdown`. Explicitly verify no orphan floating windows or modified editor focus.

Pi overlay API provides absolute `row`/`col`, but the **cursor-to-screen projection is private tab-focus work**, not solved by `ctx.ui.custom` alone. Include positioning tests around top/bottom, side edges and Pi status/prompt rows.

## 6. LSP requests, source safety and Neovim

Reuse `src/runtime.mjs`, `src/lsp-stdio.mjs`, `src/lsp.mjs` and relevant pure conversion helpers. Queries must originate **from Pi UI input**, never model tools. Use lazy configured server processes, LSP `initialize`/`didOpen`/`didChange`/`didClose`, capability checks, negotiated UTF-16/UTF-8, abort/cancellation, bounded queries and latest-request-wins display. Hover content is data only.

For `gd`, normalize `Location`/`LocationLink` with `targetSelectionRange` preference. Single target → `src/neovim-rpc.mjs` / `src/neovim.mjs` via an **existing** Neovim Unix socket; multiple targets → a transient overlay picker in the Pi transcript. Validate file URI, realpath, trusted root, destination existence and current content; convert LSP character offsets to Neovim's 1-based line and 0-based UTF-8 byte column. Pass paths as structured RPC arguments, never interpolated shell/Ex input. No new terminal/Neovim instance.

For Sidekick, the installed Neovim config loads `~/dev-trash/pi-tools` and runs Pi through a dedicated `tmux -L agents` instance. Do **not** assume `$NVIM` is propagated into detached tmux sessions. Prefer an explicitly configured Neovim `--listen` socket (or an explicit socket published by `pi-tools` if later needed). Source opening and **switching visible Neovim window focus** are separate decisions: require the former, do not steal the host focus by default. Any future optional focus policy must be tested with Sidekick's terminal buffer and custom window restoration hooks.

## 7. Release phases and ownership

| Phase | Repository | Deliverables | Gate |
|---|---|---|---|
| M0 — freeze baseline | both | Pi 1.3.0/tab-focus 1.0.2 compatibility, existing motion tests, overlay spike | Show screenshot-matching tooltip shell atop original transcript |
| M1 — upstream bridge | `pi-tab-focus` | Single input owner, immutable snapshots, cursor→screen projection, event handshake, legacy key preservation | `Tab → v → K` dispatches correct symbol without activating a new viewer |
| M2 — source semantics | `pi-intellisense` + bridge | code-region identities, verified display→source mapping, strict file-version checks, optional virtual hover | Correct LSP URI/UTF-16 column for visible symbol; wrong/unknown location never jumps |
| M3 — native overlay | `pi-intellisense` | on-symbol tooltip and transient definition/references pickers, cancellation, no focus loss | `Esc` restores identical underlying selection/viewport |
| M4 — editor jump | `pi-intellisense`, possibly `pi-tools` | existing Neovim RPC handoff and Sidekick socket verification | `gd` opens right file/line/byte column in existing Neovim |
| M5 — hardening | both | resize/stream/compaction/session switch, large hover limits, secondary LSP keys and PTY fixtures | No regressions and native test gates green |

**Do not** implement a fresh side-by-side code viewer as M1. Avoid modifying `pi-tools` until Sidekick testing shows the need. Keep bridge changes reviewable in `pi-tab-focus`; do not copy its private TUI state machinery into this repo.

## 8. Testing, state and release gates

The original `npm test` suite covers the **legacy /intel viewer and lower-level backends** (64 tests passing at planning time). It does **not** certify the requested native transcript interaction.

The native acceptance tests under `test/native/` now pass against the new implementation contracts; `npm test` is also green. `pi-tab-focus`'s local checkout has additional integration coverage. Remaining release gates concern Sidekick/tmux and edge-case UI geometry/source mapping, not basic inline hover or single-definition navigation. Tests must test input ownership, source mapping, on-symbol absolute popup geometry, `Esc` focus preservation, `gd` RPC and Sidekick constraints, not merely invoke the standalone code pane.

| Test ID | Priority | Outcome |
|---|---|---|
| NT-01 | P0 | `Tab → v → h/l/w → K` sends `textDocument/hover` for the exact symbol in the **original Pi transcript**, one invocation |
| NT-02 | P0 | Hover uses `overlay:true` with terminal-relative position adjacent to cursor; no `openCodePane`, replacement transcript or injected prompt |
| NT-03 | P0 | `Esc` closes only hover, restores exact item, cursor, viewport and selection; subsequent `y`/motions work |
| NT-04 | P0 | `gd` selects safe definition and opens at correct Neovim line/UTF-8 byte column; multiple results invoke inline picker |
| NT-05 | P0 | Item-focus `K`, `gg/ge`, pending `g`, `v/V`, yanks and Pi modals retain previous semantics |
| NT-06 | P0 | Verified read/fence/diff map exact UTF-16 position; reject ambiguity, stale file, offscreen cursor, untrusted prose |
| NT-07 | P0 | Rewrap, resize, streaming, compaction, branch/session switch and lost TUI focus cancel and invalidate safely |
| NT-08 | P1 | Unsupported/virtual snippet gives local info or virtual hover; never chooses a guessed destination |
| NT-09 | P0 | Sidekick + `tmux -L agents` can resolve an existing Neovim socket without spawning a second editor or stealing focus |
| NT-10 | P0 | Extension load order/reload/unregister, bridge mismatch and headless mode cannot steal prompt input or duplicate listeners |

**Manual E2E gate:** actually run installed Pi fullscreen with `pi-tab-focus`, `pi-vim`, a real TypeScript server and Neovim via Sidekick; show the original transcript and `K` hover together; verify `gd` and reverse focus; verify `Esc` and yank; repeat near viewport edges. Preserve a trace or screenshot and record exact versions.

The core inline `K`/`gd` path passed a live Pi/LSP/Neovim PTY smoke test as well as contract tests. Remaining verification: the user's real Sidekick/tmux configuration, alternate languages, line wrapping, streaming, multi-result pickers and production npm `pi-tab-focus` packaging. Do not conflate those remaining checks with the now-working P0 path.

## 9. References inspected

- Local installed Pi `@earendil-works/pi-coding-agent` v1.3.0, `@earendil-works/pi-tui` `OverlayOptions` and `overlay-qa-tests.ts`
- Installed `pi-tab-focus` 1.0.2: `src/index.ts`, `src/vim-navigation.ts`, `src/transcript-observer.ts`, `src/fullscreen-layout.ts`
- `~/dotfiles-stow/nvim/.config/nvim/lua/user/plugins/sidekick.lua` and `~/dev-trash/pi-tools/lua/pi-sessions/sidekick.lua`
- https://github.com/philvernon/pi-tab-focus
- https://github.com/philvernon/pi-intellisense
- https://github.com/philvernon/pi-tools
- https://github.com/folke/sidekick.nvim
- https://neovim.io/doc/user/api/