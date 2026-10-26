# Source-aware transcript refactor — verification

## Automated results

| Repository | Command | Result |
|---|---|---|
| pi-intellisense | `npm test` | **159 passed** |
| pi-intellisense | `npm run test:native` | **34 passed** |
| pi-intellisense | `npm run build` | TypeScript check and extension import passed |
| pi-intellisense | `PI_TAB_FOCUS_SOURCE=~/dev-trash/pi-tab-focus/src/index.ts npm run test:integration` | **9 passed, none skipped** |
| pi-intellisense | `npm audit` | **0 vulnerabilities** |
| local pi-tab-focus | `npm test` | **76 passed** |
| local pi-tab-focus | `npm run typecheck` | Passed |

Active LSP probes returned no error diagnostics on changed runtime files. Some TypeScript push-only checks could not positively confirm clean state; the explicit compiler check above passed independently.

Review regressions cover fence/prose identity isolation, raw number-like source, limit notices colliding with unread source, native path aliases, Pi-consistent character widths, concurrent LSP initialization, UTF-16 negotiation, cancellation/source checks through editor startup, split-reflow error reporting and foreign-dialog cancellation with an own-picker exemption.

The development Pi and Pi TUI dependencies are pinned to 1.3.0 for typechecking. Its vulnerable pinned `undici` is overridden to the patched 8.12.2-compatible range in this repository only. No global Pi installation was modified.

## Real process/terminal evidence

- **Real TypeScript LSP:** verified file-backed annotated source hover/definition and unsaved generated-code hover, without creating a virtual source file.
- **Automatic imported-method context:** a normal usage-only assistant fence recovered `usage.ts` from read history at UTF-16 `{line:4, character:12}`. Hover returned `(method) Greeter.describe(): string`, not `any`, and definition resolved to `greeter.ts` at `{line:1, character:2}`.
- **Cold workspace lookup:** actual TypeScript `workspace/symbol` found an imported `myMethod` without any transcript read history, with both explicit and inferred workspace language.
- **Real Pi workspace-only transcript:** a plain fence containing `greet(café);`, without a language tag, annotations or prior reads, produced real typed hover and lazy `gd` navigation to the workspace definition. Hierarchical document-symbol support supplies the identifier selection range when workspace symbols span an entire declaration.
- **Real tmux/Neovim:** started with no editor, lazily launched a visible Neovim split, and reused the same socket for a second navigation. The actual first cursor was `[2,19]`, proving byte-column conversion after `café`; the second was `[1,6]`. The source filename included spaces, shell separators and `$(...)` as literal data.
- **Real Pi annotated assistant transcript:** loaded this package through `pi -e <package-directory>` and the actual companion tab-focus extension in an isolated fullscreen terminal. Source attributes were hidden; keyboard `K` displayed real LSP hover; `Esc`, then `gd`, launched Neovim and opened `test/fixtures/source.ts` at **line 2, byte column 16**.
- **Real Pi read-result transcript:** replayed an actual structured `read` call/result fixture, expanded the tool output, and navigated through the real visual cursor. Hover and lazy definition navigation reached the same verified destination without a source annotation or another viewer.
- **Real Pi automatic assistant quote:** after successful read history, an ordinary unannotated `greet(café);` fence produced `function greet(name: string): string` on actual `K`. Actual `gd` launched Neovim at `test/fixtures/source.ts`, cursor `[2,16]`, with no annotation or extra model turn.

Pi terminal tests use saved fixture sessions, isolated configuration, offline mode and no model requests. Each test owns a separate tmux server. The runtime Neovim test uses `--clean`; the real Pi cases use the launcher’s normal Neovim command. Servers/editors created for tests are cleaned up without touching user sessions.

Versions exercised: Pi **1.3.0**, Node **24.18.0**, workspace TypeScript **5.9.3**, typescript-language-server **6.0.2**, tmux **3.8**, Neovim **0.13.0-dev-1529+g06bff27929**.

## Deliberate boundaries

1. The source-aware bridge changes are local to `~/dev-trash/pi-tab-focus`; they have not been published or installed globally. Load that checkout once, not alongside an older npm copy.
2. Wrapped/truncated/oversized regions cannot establish exact known-file positions, but visible identifiers can use workspace lookup. Ambiguous workspace results require a picker. Full renderer-level wrapping and diff provenance are not implemented.
3. Real Neovim/Sidekick embedding and every pi-vim outer-mode interaction have not been tested. Plain Pi inside tmux, including actual lazy editor startup, has been tested.
4. Other language servers and the optional experimental pi-lens MCP provider were not live-certified by this refactor. MCP tests use a mock child process; that provider is not a shared in-process pool.
5. Managed editor reuse is session-scoped. Pi does not terminate user editors on shutdown. After a reload, configure the existing editor socket if it should be reused.
6. Regular/non-fullscreen transcript navigation is not supported. The default/native tests separately cover prompt/modal ownership and stale-request suppression.
7. Pi's additional macOS filename fallbacks (AM/PM spacing, NFD and curly quotes) are not mirrored. Native reads relying on them safely remain unmapped; ordinary `@`/tilde/Unicode-space/file-URL aliases are supported.

The separate `/intel` viewer, binary wrapper, duplicate controllers and test-only bridge/host/source implementations have been removed. The production source mapper is now used by both the live extension and its mapping tests.
