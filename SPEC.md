# Pi IntelliSense — implementation specification

Status (2026-10-23): **core and standalone `/intel` TUI code pane implemented and tested**. The native `pi-tab-focus` transcript bridge remains specified but is not upstream-integrated; it cannot yet provide in-place `K` or `gd`. The sections below describe the target end state rather than claiming that all native-transcript features are present. Target: Pi fullscreen TUI with `pi-tab-focus` and an already-running Neovim.

## Implementation checkpoint

Working components: `src/index.ts` registers `/intel`, `src/ui/code-pane.ts` implements Vim-like navigation, read-only LSP hover/completion and destination pickers, `src/runtime.mjs` and `src/lsp-stdio.mjs` run local language-server JSON-RPC, and `src/neovim-rpc.mjs`/`src/neovim.mjs` implement structured local Neovim navigation. Verified code spans are mapped using `src/provenance.mjs`. Tests pass (see `VERIFICATION.md`).

Missing for the primary native-transcript goal: the external `pi-tab-focus` extension does not expose cursor/source maps via the proposed event-bus bridge. The extension registers a bridge consumer but cannot bind direct transcript gestures until those upstream changes land. See `docs/UPSTREAM_BRIDGE.md`. Actual Pi + real language-server + actual Neovim smoke testing is pending.

## 1. Goal and boundaries

In a Pi chat transcript, use `Tab` to enter `pi-tab-focus`, navigate rendered code with its visual cursor, press `K` to see language-server hover/type documentation, `gd` to resolve a definition and open it at file/line/column in the user's existing Neovim, and use other familiar LSP motions. Keep all existing transcript browsing, selection, yank and links. **Do not invoke the AI/model** for an LSP query.

In scope:
- Pi fullscreen transcript focus, including assistant prose/code fences and `read`/tool outputs **only when trustworthy file provenance exists**.
- LSP hover, definitions, declarations, implementations, type definitions, references, document symbols, diagnostics, signature help and optional completion list (read-only).
- Neovim remote navigation to an existing instance, multiple target selection and clear error states.
- Compatibility with `pi-tab-focus` visual cursor, existing selections, Ctrl+O/tool expansion, thinking toggles and pi-vim.
- Explicit source provenance, accurate rendered-to-source mapping, safe boundaries, cancellation, cache invalidation, accessibility and tests.

Out of scope v1: modifying code via rename/code actions, actually inserting completions into chat, writing buffers, implicit navigation from ungrounded snippets, replacing Pi's entire transcript UI, auto-starting an arbitrary Neovim terminal, model tool calls, symbol name guessing across a workspace without confirmation. Hover is a popup opened with a key; pointer hover is optional after a supported mouse position mapping exists.

## 2. Verified upstream facts and integration decision

The public `philvernon/pi-tab-focus` (main branch inspected 2026-10-23; npm `pi-tab-focus` 1.0.2) currently:
- enables fullscreen transcript mode with `Tab` and installs `ctx.ui.setEditorComponent` plus a **pre-editor** `ctx.ui.onTerminalInput` listener; restores them on shutdown;
- observes rendered transcript components via `TranscriptRenderObserver` and has `TranscriptItem { key, semanticKey, kind, startRow, endRow, text, linkSourceLines }`;
- has `VimVisualNavigation.snapshot().head: { row, col }`, a terminal-display-column cursor and grapheme-aware motions; supports `v/V`, yank and OSC 8 links;
- currently reserves `K` for previous transcript item **outside visual mode**, `g` for scroll-to-top in item mode and visual `g` as a prefix for `gg/ge`, not `gd`. Existing normal `k` remains scroll up.
- uses Pi private fullscreen TUI fields to recover rendered lines, selection and layout. These are version-sensitive.

Pi documents `pi.events.on/emit` for extension-to-extension communication, `ctx.ui.custom(..., {overlay:true})` for interactive displays, `matchesKey`, `ctx.mode === "tui"`, `session_shutdown` cleanup and mouse routing in fullscreen. Pi **does not expose a documented arbitrary transcript-symbol-hit-test API**. Do **not** install a second competing `onTerminalInput` hook to steal `K/gd` or parse rendered ANSI output as semantic source.

**Decision:** implement a small upstream-compatible **pi-tab-focus bridge** (separate PR to `philvernon/pi-tab-focus`) and install `pi-intellisense` as a separate Pi extension. The bridge is the sole transcript input owner, providing trusted cursor/item snapshots and consuming registered gestures. Implement the bridge against actual code before Pi integration. Do not copy pi-tab-focus's private layout observer into this project. An optional future public API can replace the bridge without changing the IntelliSense core.

### Proposed bridge v1 (new contract; NOT yet present upstream)

Via `pi.events` (Pi's inter-extension event bus):
- `pi-intellisense:register:v1` emitted at `session_start` by the IntelliSense extension, carrying a **session-lifetime callback** `invoke(operation, focusSnapshot): void | Promise<void>` and an operation/key map; tab-focus retains at most one registration with id `pi-intellisense`.
- `pi-intellisense:unregister:v1` emitted on `session_shutdown`; dispose function/handler when tab-focus shuts down or reloads.
- `pi-tab-focus:availability:v1` from tab-focus at initialization, for handshake/re-registration across extension ordering. Bridge registration should be resilient to either extension loading first (listeners established at factory load, register/replay on session start), without duplicate listeners.
- `FocusSnapshotV1 = { version:1, sessionId, semanticKey, kind, sourceRevision, visualCursor:{row,col}, selectedText?, renderedLines:readonly string[], itemStartRow, itemEndRow, codeRegions?:... }`; row/col are absolute rendered transcript coordinate and terminal columns. Copy values on invocation (do not hand out mutable TUI objects).
- Callback returns a promise for command completion; tab-focus starts it without blocking keyboard dispatch or keeping unhandled rejected promises; failures notify via the IntelliSense extension.

Only capture registered gestures **when visual navigation is active**, cursor is on a code token and there is no active transient overlay or EX detour. No cursor at an item level means `K` retains original previous-item behavior and `g` scroll-to-top. In visual mode, extend `VimVisualCommand`/`VimVisualNavigation` with a composition-safe key grammar; add `gd`, `gD`, `gi`, `gr`, `gy`, `K`, `[d`, `]d`, `<C-k>` (signature help), `<C-space>` (completions) if registered. Preserve `gg`, `ge`, counts, pending `f/F/t/T`, text objects and `y/c`. Unknown or unavailable sequences preserve legacy semantics. `K` in visual mode is not bound today, so no visual collision. Unmodified `K` in item focus stays previous-item; users must enter visual cursor (`v`) for semantic keys. Consider configurable `hoverInItemMode` only after defining cursor acquisition.

## 3. User workflow and key map

| Context | Key | Action | Result |
|---|---|---|---|
| editor | `Tab` | transcript focus | existing behavior |
| item focus | `v` | enable visual cursor | existing behavior; text cursor visible |
| visual cursor on symbol | `K` | hover | themed, scrollable popup with signature, docs, language and source |
| visual cursor on symbol | `gd` | definition | single location → remote Neovim; multiple → list then remote |
| visual cursor on symbol | `gD` | declaration | same target resolution |
| visual cursor on symbol | `gi` | implementation | same target resolution |
| visual cursor on symbol | `gy` | type definition | same target resolution |
| visual cursor on symbol | `gr` | references | location picker grouped by file, count and preview |
| visual cursor | `[d` / `]d` | diagnostics previous/next | jump to diagnostic on corresponding mapped file; show detail |
| visual cursor | `<C-k>` | signature help | overlay if supported |
| visual cursor | `<C-space>` | completion preview | show results, no insertion |
| visual cursor | `gs` | document symbols | searchable symbol picker, open Neovim |
| any IntelliSense popup | `Esc` | close only popup | returns visual cursor, does not exit Pi focus |
| visual cursor | `y`, `v/V`, `gg/ge`, motions | existing commands | unchanged |
| item focus | `K`, `g`, `y`, `Enter` | existing item navigation/copy/link | unchanged |
| any IntelliSense action | `Tab` | dismiss popup or existing focus transition | never writes editor text |

`go to` opens the destination in Neovim; no `K` equivalent needs Neovim. `gd` resolves from **source file identity**, not the selected symbol string alone. Users may explicitly attach a file when displayed code is otherwise ungrounded via optional `/intel bind <absolute-or-project-relative-path>` and a matching span confirmation (not blind string guessing). Include `/intel status`, `/intel config`, `/intel servers` and actionable diagnostics.

## 4. Provenance and rendered-to-source coordinates — critical correctness requirement

The transcript cursor is **not** a source position. Render coordinates use terminal display width, while LSP uses zero-based UTF-16 code units (unless server negotiates UTF-8/UTF-32). Create `SourceAnchor` only for validated source:

```ts
interface SourceAnchor {
  sourceUri: string;           // file:// URI, validated canonical local path
  sourceVersion: string;       // hash/mtime+size of source bytes used for match
  displayedRevision: string;   // render/layout identity
  sourceStart: { line: number; character: number }; // LSP zero-based UTF-16
  sourceEnd: { line: number; character: number };
  origin: "read-tool" | "diff-hunk" | "verified-fence" | "explicit-bind";
  confidence: "verified";      // no guessed source position is executable
}
interface DisplaySpan {
  itemSemanticKey: string;
  displayRow: number;          // absolute transcript row
  displayColStart: number;     // terminal cell offset inclusive
  displayColEnd: number;       // exclusive
  anchor: SourceAnchor;
}
```

Layered extraction:
1. **Rich provenance** when Pi tool-result details expose a real path/range/bytes (do not trust agent prose). For `read` tool results, parse exact path, one-based line labels and content; verify those exact strings against disk before creating anchors. A tool mentioning a path in prose is not sufficient.
2. A unified diff may carry `+++ b/path`, `@@ -a,b +c,d @@`; map *only + context lines* to the after-file and *only - context lines* to the before-file when matching real versions; avoid diff metadata/header lines.
3. Fenced Markdown labeled `path/to/file.ts` can map only after verifying that displayed lines match an unambiguous contiguous range in the current file (or a pinned source snapshot), and when source path is within allowed roots.
4. Assistant-generated code without an exact match, filenames without match, chat prose, wrapped lines with ambiguous formatting and unverified clipboard snippets stay unmapped. `gd/K` show `No verifiable source for this code` (with optional explicit bind), not arbitrary search results.
5. A verified explicit bind is tied to item identity, file hash and exact matched range; expires when transcript or file changes.

Build a display `SourceMap` **before styling/truncation where feasible** with mapping from rendered rows and terminal-column spans to original code text and source location. If the existing renderer supplies no semantic span API, augment `pi-tab-focus` observer on rendered components to keep original text and line wraps; derive a map only for cases where displayed source and file bytes can be proven equal. Each map is revision keyed by `semanticKey`, transcript content revision, terminal width, scroll/layout revision, file hash and source region. **Do not equate displayed columns with UTF-16 offsets**.

Edge cases: ANSI sequences, backticks, syntax highlighting, OSC8 links, tabs (configured tab stops), CRLF, surrogate pairs, emoji/wide graphemes, combining marks, zero-width joins, long wrapped lines, truncated output, partial streaming, line-number prefixes, selection cursor on punctuation or whitespace and stale source after file edits. Click/move endpoints snap to the containing identifier's start; no cross-token hit by guesswork. For source position tokenization, prefer language-server `documentHighlight`/semantic tokens or a syntax-aware identifier extractor; a safe lexical fallback may identify an explicit identifier within an already-verified source span. Entire escaped/decoration cells remain unselectable. For positions with multiple possible anchors, require a picker or decline.

Tests MUST prove exact UTF-16 target for strings such as `const café = "😃"; café;` and exact rendering cell map for wide glyphs. Re-validate the file hash/version immediately before executing an LSP request; queue `didOpen` with exact file content, `didChange` on disk watcher or fresh read, and reject stale hover/navigation results by request/revision token.

## 5. LSP backend

Implement a **UI-facing client independent from model tools**. Existing `pi-lsp-extension` and `pi-lsp-adapter` expose LSP calls to the agent but do not document a stable programmatic service API. Do not silently invoke model tools, couple to their private server-manager modules or spawn duplicate shared daemons without detection.

Suggested stack: Node/TypeScript, `vscode-jsonrpc`, `vscode-languageserver-protocol` types and `vscode-uri`; minimal `LspBackend` interface:
```ts
interface LspBackend {
  query(request: {
    kind: "hover" | "definition" | "declaration" | "implementation" |
          "typeDefinition" | "references" | "diagnostics" |
          "documentSymbols" | "signatureHelp" | "completion";
    uri: string;
    position?: { line: number; character: number };
    documentVersion: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  close(): Promise<void>;
}
```
- Per-workspace root, language ID and command configuration; resolve roots via nearest LSP project marker (tsconfig, Cargo.toml, go.mod, etc.). Lazy process startup; initialize/capabilities/initialized lifecycle, explicit `textDocument/didOpen`/`didChange`/`didClose` and shutdown/exit. Track open-file refs, watchdog, capability checks, process exits/restarts, request cancellations (`$/cancelRequest`), timeout and no-server states.
- LSP `Location | Location[] | LocationLink[] | null` normalization with correct `targetSelectionRange` preference; URI decode/validation; no arbitrary scheme execution. `MarkupContent` plaintext/Markdown hover sanitization. Filter/sort/dedupe reference locations deterministically. Decode `WorkspaceEdit` only for future preview, never apply in v1.
- Position encoding negotiated per server; default UTF-16. Cache hit by URI, file-version, method, position and server generation; invalidated on `didChange`/reconnect. Request budgets: hover 2s, navigation 5s, cold-start 10s (configurable). Show spinner and permit `Esc` cancellation; ignore late results using `requestId` and `sourceRevision`.
- Server discovery explicit, configured commands only. No silent language server installation, LSP server commands only from trusted settings and sanitized cwd/env; no global workspace scanning or unrelated project access. Provide a status table of detected servers/capabilities.
- Design integration seam `LspBackend` so a later **public**, verified adapter to `pi-lsp-extension` can reuse a running server without changing UI/navigation.

## 6. Neovim remote adapter

An explicit `NvimRemote.open({ uri, line, character })` gateway. Prefer an authenticated existing Neovim Msgpack-RPC Unix socket: configuration `neovim.server` then trusted `NVIM` environment, validated as a local socket. Fail with an actionable message when no server exists. No shell interpolation. Do not start nested Neovim within Pi's TUI, assume tmux, guess process IDs, or use remote `--remote-send` with unescaped user-controlled paths.

For a remote editor connection, call Neovim API with **structured RPC args**: `nvim_exec_lua` with static code and an argument array containing validated absolute local path, one-based line and zero-based UTF-8 byte column. Lua uses `vim.fn.fnameescape(path)`, `vim.cmd.edit(...)` and `vim.api.nvim_win_set_cursor(0,{line,bytecol})`. Convert LSP UTF-16 column to UTF-8 byte offset from the **destination file line**; clamp to valid boundary; for LocationLink use targetSelectionRange start. Prefer reuse of the current window, optionally split/tab based on config. Respect realpath symlink policy, file existence, workspace root allowlist and file URI scheme. Preserve the current Pi focus state, do not force TUI takeover; if editor runs in another tmux pane, optional explicit pane-focus configuration may be implemented later, never implicit.
- Multiple definitions/references show a picker with `path:line:col` before an RPC command.
- Invalid socket, editor exit and RPC errors render safe notifications, no modification to files.
- Tests mock Msgpack transport and verify structural arguments, UTF-16→UTF-8 conversion, spaces/quotes/semicolons/shell metacharacters and no shell execution.

## 7. UI behavior and composition

- The bridge owns focus and gestural key interpretation. The IntelliSense extension owns a cancellable `ctx.ui.custom` overlay (or `ctx.ui.select` for multi-targets), leaving Pi scrollback beneath it. Since `pi-tab-focus` guards `getFocusedComponent` for transient overlays, it yields keyboard control. Restore exact visual cursor on popup close where the item/revision still exists. Render Markdown safely through Pi's own `Markdown` component. Constrain width/height, wrap lines via `visibleWidth` utilities, support scrolling and small terminals.
- One query per key action, dedupe repeated keys, latest-wins cancellation. Show `Loading LSP…` immediately, `No hover information`, `Language server unavailable`, `Source mapping unavailable` and `Stale code; reopen current file` distinctly.
- Never display raw server escape sequences or clickable URI schemes beyond approved file or https. Apply Pi theme on redraw. All panels close on `Esc`, session switch/reload/shutdown, and TUI mode change.
- `ctx.mode !== "tui"` and regular (non-fullscreen) mode: disable interactive gestures without errors or lost prompt input. Event handlers must have no effect when no tab-focus bridge exists; `/intel status` explains missing prereqs.

## 8. Configuration and package skeleton

Target package `pi-intellisense` with manifest `pi.extensions: ["./src/index.ts"]`. Trusted global `~/.pi/agent/pi-intellisense.json` and trusted project `.pi/pi-intellisense.json` overlays. Configuration sample:
```json
{
  "enabled": true,
  "hoverKey": "K",
  "definitionKey": "gd",
  "referencesKey": "gr",
  "neovim": { "server": "env:NVIM", "openMode": "current", "focusPane": false },
  "lsp": { "timeoutMs": 5000, "autoInstall": false, "servers": {} },
  "allowOutsideProject": false,
  "strictSourceMapping": true
}
```
Validate against a schema; explicit per-project config is ignored in untrusted worktrees. Require `pi-tab-focus` **with bridge v1** and Pi fullscreen mode. Minimum Pi/TUI version should be pinned by a test matrix rather than assumed from current docs; pi-tab-focus README documents Pi 0.85.1 and pi-vim 0.14.2.

Implementation units:
```
src/index.ts                 Pi session/lifecycle/commands and bridge registration
src/bridge/protocol.ts       event names and versioned payloads
src/bridge/tab-focus.ts      registration/cursor snapshot validation
src/provenance/read.ts       tool read/diff/fence provenance resolver
src/provenance/source-map.ts render → file UTF-16 mapping
src/provenance/version.ts    source content/version checks
src/lsp/backend.ts           interface and JSON-RPC lifecycle
src/lsp/normalize.ts         Location/LocationLink and hover normalization
src/ui/hover.ts              themed popup and stale-query lifecycle
src/ui/picker.ts             source-location picker
src/neovim/remote.ts         Msgpack-RPC adapter, URI and cursor conversions
src/config.ts                schema and trust/config defaults
```
Required bridge changes **in pi-tab-focus repo**, not duplicated here: expose frozen source/cursor snapshot; add gesture grammar using `VimVisualNavigation` pending-command mechanism; dispatch to registered handler; add mapping metadata from transcript observer; reset binding on shutdown. Maintain upstream tests.

## 9. Error handling, trust and performance

A navigation request must satisfy all invariants: supported TUI mode + visual cursor, exact transcript item identity, verified source URI/version, valid token mapping, LSP capability + live server and safe Neovim destination. Violating any step is a **non-navigation** state. No fallback `ripgrep` and opening the first symbol match silently.

Do not trust generated transcripts, code fences, tool output or LSP metadata as instructions. Max input file size and number of LSP results configurable, cap hover Markdown, sanitize escape/control chars, reject remote paths unless explicitly enabled, validate normalized URI against realpath project roots. Never pass path or hover content through a shell. Abort watchers/requests on session teardown. Avoid probing private Pi UI fields outside the tab-focus bridge.

Performance budgets on warm language server: keypress→visible loading state <50ms; hover result target <250ms when server responds within that bound; all potentially expensive matching, syntax/highlighting and I/O off render path. SourceMap caches bounded and revision-scoped. None of these timings is guaranteed by upstream LSP processes.

## 10. Verification plan / acceptance tests

Contract tests under `test/` are written **before production modules**. Their current failing status is intentional (RED phase); `node --test` fails until `src/` contracts are implemented. Do not mark assertions as passing by stubbing out behavior. Tests use injected fake LSP/Neovim adapters to avoid modifying the actual editor or launching servers.

1. **Keys & bridge:** `K/gd/gD/gr/gi/gy` only in visual cursor; `gg/ge` and `y` unchanged; uppercase item `K` and item `g` unchanged; no keystrokes leak to prompt; double `g` and invalid sequence cleanup; popup-focus handoff and shutdown unsub.
2. **Provenance:** verified read lines/diff hunks/bound fenced code map to file:UTF-16 accurately; ambiguous, fabricated, stale or external source rejects; duplicate text requires disambiguation; wrap/tab/ANSI/OSC8/CRLF/emoji/café/ZWJ semantics correct; cache invalidation upon resize/stream/file edits.
3. **LSP:** exact request URI/position/method; hover Markdown/text, definition and LocationLink normalization, references picker, cap checks, request timeout/cancel and last-request-wins; initialization/didOpen/didChange/shutdown and restart.
4. **Neovim:** existing socket required, no shell usage, structured arguments and safe path quoting, correct cursor for multibyte and off-by-one, missing file/outside-root denied, multi-location selection and error recovery.
5. **Pi integration:** headless/no fullscreen/no tab-focus leave prompt intact; event ordering and reload; overlays, narrow terminal/resize, focus restoration; `pi-vim` composition.
6. **Manual E2E:** `pi --tui-mode fullscreen` and actual `pi-tab-focus` bridge with TS and Rust LSP servers, Neovim `--listen` socket; validate roundtrip keypress and UI. Confirm no ghost navigation from assistant-synthesized code. Need a real PTY for these (not CI-only unit tests).

### Exit criteria for implementation
- P0: hover and definition jump work from a verifiably sourced transcript code token through existing Neovim.
- P0: no wrong-file jumps, no prompt corruption, no lost `pi-tab-focus` yank/navigation.
- P0: tests for mapping/keys/security and remote API green; explicit error on unsupported snippets.
- P1: refs, implementation, type def, declaration, picker and diagnostics.
- P2: completion list, signature help, source bind UX and pointer hover.

## 11. Risks / decisions pending implementation

- **Bridge is not yet upstream.** Need changes to `philvernon/pi-tab-focus`; separate extension alone cannot safely inspect its private cursor state or arbitrate its input pipeline. Check exact source commits/version when implementing.
- **Rendered code is not automatically source code.** Strict matching will decline many assistant-synthesized snippets by design. If the product requires IntelliSense on arbitrary non-file snippets, it needs virtual LSP documents and a separately specified workspace/language context; `gd` to actual files remains best-effort and must not silently guess.
- **Shared LSP process integration:** current third-party Pi LSP packages are agent tools, not a tested public library. Independent backend is preferred until a stable service API exists.
- **Neovim socket discovery:** explicit socket wins. `NVIM` availability depends on how Pi is launched. No live socket means show setup guidance, not launch or guess.

## 12. Reference sources checked

- Pi official extension API: https://pi.dev/docs/latest/extensions
- Pi terminal UI API: https://pi.dev/docs/latest/tui
- Pi keybindings: https://pi.dev/docs/latest/keybindings
- Pi event bus example: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/event-bus.ts
- `pi-tab-focus` source: https://github.com/philvernon/pi-tab-focus/tree/main/src (specifically `index.ts`, `vim-navigation.ts`, `transcript-observer.ts`, `fullscreen-layout.ts`)
- `pi-tab-focus` published usage: https://pi.dev/packages/pi-tab-focus
- Pi LSP package examples: https://github.com/samfoy/pi-lsp-extension ; https://pi.dev/packages/pi-lsp-adapter
- Neovim remote flags: https://neovim.io/doc/user/remote/ and editor API: https://neovim.io/doc/user/api/
