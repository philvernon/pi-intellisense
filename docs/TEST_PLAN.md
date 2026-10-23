# Native transcript IntelliSense — acceptance test plan

**Canonical test plan (2026-10-23).** Replaces the exploratory standalone-viewer plan. The user's requirement is **inline hover/navigation in the original Pi transcript**, using `pi-tab-focus` visual navigation. Core implementation is present in the current local checkout and verified against Pi 1.3.0, TypeScript LSP and headless Neovim.

## Suites and status

| Suite | Command | Current result |
|---|---|---|
| Existing regression | `npm test` | 64 existing backend and separate `/intel` code-pane tests; GREEN |
| Native contract | `npm run test:native` | New NT-01..NT-10 tests importing **not-yet-implemented** native API modules; GREEN |
| Combined gate | `npm run test:all` | GREEN for the currently implemented contracts |
| Static/module build | `npm run build` | Syntax / import check; does not prove real Pi integration |

Native contracts are implemented and passing. Do not claim Sidekick/tmux coverage from isolated unit tests or confuse the transitional `/intel` viewer with the native feature.

## Traceability

| ID | Priority | Automated suite | Required behaviour |
|---|---|---|---|
| NT-01 | P0 | `native/focus-bridge.contract.test.mjs`, `native/native-controller.contract.test.mjs` | Original transcript visual cursor `K` triggers exactly one hover LSP request for correct source URI/position |
| NT-02 | P0 | `native/inline-hover.contract.test.mjs` | Actual overlay via `ctx.ui.custom(...,{overlay:true,overlayOptions:{row,col,...}})`, near selected symbol in original Pi transcript; never `openCodePane` |
| NT-03 | P0 | `native/inline-hover.contract.test.mjs` | `Esc` closes popup only, restores visual cursor, selected item, viewport, yank state |
| NT-04 | P0 | `native/native-controller.contract.test.mjs` | `gd` → `textDocument/definition` → location-normalization → existing Neovim; multiple destinations display Pi overlay picker |
| NT-05 | P0 | `native/focus-bridge.contract.test.mjs` | Item `K`, visual `gg/ge/gE`, `g` pending, `f/F/t/T`, copy/yank and Pi modal input semantics preserved |
| NT-06 | P0 | `native/source-map.contract.test.mjs`, `native/native-controller.contract.test.mjs` | Verified display symbol hit maps correct UTF-16; rejects unmapped, ambiguous, fabricated, stale, gutter, whitespace and wrong revision |
| NT-07 | P0 | `native/inline-hover.contract.test.mjs`, `native/native-controller.contract.test.mjs` | Scroll/reflow/resize/streaming/session change cancels or invalidates old popup/result safely |
| NT-08 | P1 | `native/source-map.contract.test.mjs` | Virtual document may provide hover for generated snippet, but no guessed source navigation |
| NT-09 | P0 | `native/neovim-sidekick.contract.test.mjs` | Sidekick + `tmux -L agents`: explicit socket routing, existing Neovim RPC, no nested editor/focus hijack |
| NT-10 | P0 | `native/focus-bridge.contract.test.mjs` | Correct bridge lifecycle, session isolation, load order, unregister/hot reload, modal key handoff |

### Fixtures and limits

- `createTabFocusNativeBridge` is an **upstream implementation contract**; the production integration belongs inside `pi-tab-focus`'s existing input dispatcher. The test harness should be portable to the `pi-tab-focus` repository. No second `pi-intellisense` raw-input listener.
- Geometry fixtures explicitly distinguish absolute transcript row/col and terminal-relative screen row/col.
- Source fixtures include a wide `界` character before `café`, duplicate spans, old revisions and modified file hashes. Expand with ANSI, OSC8, CRLF, ZWJ, tabs, soft wrap, tool line gutters and code-fence indentation before declaring complete.
- Fake UI records calls to `ui.custom`, forbids `setEditorComponent` and rejects `sendUserMessage`.
- The fake LSP emits deterministic `Location`, `LocationLink`, hover Markdown and delayed responses. The fake Neovim records `open` calls.
- Real terminal integration is **not simulated** by these pure contract tests; a PTY/fullscreen test harness and manual validation remain mandatory.

## Manual end-to-end test — real Pi + Neovim

Environment: Pi 1.3.0 fullscreen, `pi-tab-focus` bridge-enabled version, `pi-vim`, real TS LSP, Neovim started with a known `--listen` socket and launched through the installed Sidekick configuration under `~/dev-trash/pi-tools` using `tmux -L agents`.

1. Ask Pi to display a TypeScript file-backed snippet with an obvious function call, in the ordinary chat transcript.
2. `Tab` enters transcript item focus, `v` enters visual cursor, `w/l/h/j/k` select a code symbol. Confirm original Pi message remains visible (no /intel view).
3. `K` displays the hover tooltip **beside the symbol** over the original chat text. Capture screenshot; verify type/docs originate from real LSP, no model request.
4. `Esc` closes tooltip; verify identical item/cursor/viewport and immediate ability to yank or move.
5. `gd` opens the precise target file/line/byte column in the existing Neovim. Test multiple targets and cancel.
6. Repeat with code near right/bottom viewport, narrow screen, line wraps, tool expansion and a source changed on disk; verify no stale tooltip/jump.
7. Verify `K` on transcript item focus still moves to previous message; `gg`/`ge` work; no input leakage to prompt, menus or pi-vim EX.
8. Test with Pi launched via Sidekick/agents tmux both with and without inherited `NVIM` and verify explicit socket configuration.

**Verification completed:** native contracts green and actual Pi fullscreen `K` tooltip plus `gd` definition navigation to the existing Neovim socket were tested with a scripted PTY and a real TypeScript server. **Outstanding:** Sidekick/tmux focus/socket test, alternate language servers, advanced line wrapping and streaming. NT-08 remains a later virtual-document enhancement.

## Repositories

- `pi-intellisense`: source verifier, LSP, popup/overlay + Neovim routing, native contract tests.
- `pi-tab-focus`: visual cursor/source-region export and single keyboard dispatcher, upstream tests.
- `pi-tools`: existing Sidekick/Neovim host wiring; change only if smoke tests require it.
## V2 follow-up gates (implemented and verified 23 October 2026)

| Gate | Automated and runtime evidence | Status |
|---|---|---|
| Focus | Inline hover Tab/Esc tests and actual fullscreen Pi PTY typing in prompt after Tab | Passed |
| Cancellation | Delayed LSP return after `snapshot.isCurrent()` becomes false | Passed |
| Source provenance | Original structured read call/path + disk-verified numbered lines, no visible filename | Passed in fixtures |
| Generated source | Read-only virtual TS fenced source with real TS language server hover in Pi | Passed |
| No unsafe jumps | Original source hash rechecked after LSP returns; Neovim target validated | Passed in automated tests |
| Providers | Read-only standalone and pi-lens MCP adapter, MCP mock child process | Passed in tests; **real pi-lens MCP unavailable** |
| Real sidekick | Sidekick/tmux-hosted Pi and Neovim, pane focus and inherited socket | Not tested |

For full implementation scope and remaining source-wrap/reflow cases see [REFACTOR_PLAN.md](REFACTOR_PLAN.md). No additional Pi prompt/model turns are caused by keyboard LSP queries.
