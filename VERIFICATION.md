# Verification — transcript IntelliSense v2

Date: 23 October 2026.

## Baseline checkpoint (saved and pushed before v2 changes)

- [pi-intellisense](https://github.com/philvernon/pi-intellisense): `de1d652` — native Pi transcript IntelliSense baseline.
- [pi-tab-focus](https://github.com/philvernon/pi-tab-focus): `a5bdb55` — upstream bridge baseline, rebased over published release 1.0.2.
- This refactor was developed on top of those commits and verified before the v2 push.

## Automated verification

| Repository | Command | Result |
|---|---|---|
| pi-intellisense | `npm test` | **75/75 passed** (previous behaviour, live source resolver, typed provenance, provider adapter and MCP mock transport) |
| pi-intellisense | `npm run test:native` | **28/28 passed** (native hover, Tab/Esc, delayed response, source checks and Neovim) |
| pi-intellisense | `npm run build` | Passed, entrypoint imported |
| pi-tab-focus | `npm test` | **70/70 passed** (legacy keys plus bridge, Tab focus return and pending-prefix invalidation) |
| pi-tab-focus | `npm run typecheck` | Passed |

## Real process/terminal verification

- **File-backed transcript:** launched Pi 1.3.0 in a real fullscreen pseudo-terminal with patched pi-tab-focus, pi-intellisense and test-only code snippet extension. Hover `K` over a TypeScript symbol displayed the actual LSP signature in a Pi floating overlay over the **original transcript**.
- **Definition handoff:** dismissed hover with `Esc`, invoked `gd`; an already-running `nvim --headless --listen` instance reported `test/fixtures/source.ts`, line **2**, byte column **17**. No separate `/intel` pane was used.
- **Generated unsaved snippet:** `/smoke-virtual` displayed a generated TypeScript code fence without a path and without writing a file; `K` showed a real TypeScript LSP function signature from the in-memory synthetic document.
- **Editor focus:** pressed `Tab` while this hover popup captured focus, then typed `v2_editor_focus`. The typed text appeared in Pi's prompt editor, establishing that the popup no longer swallows Tab or retains the transcript focus.
- **Provider transport:** a real Node child mock of the pi-lens MCP server completed `initialize`, `tools/list` and `tools/call` using newline-delimited JSON-RPC, returning test hover/definition payloads.

## Open limitations (do not infer passes)

1. Installed `pi-lens` 4.4.3 MCP executable failed startup with `ERR_MODULE_NOT_FOUND: Cannot find package 'typebox'`. The optional adapter has mocked process/contract coverage but **no live pi-lens integration**. Standalone stdio LSP is the default.
2. No real interactive Sidekick/tmux `-L agents` host test was run. Use an explicit Neovim Unix socket; automatic window-focus switching remains out of scope.
3. Long wrapped/truncated transcript lines, full original Markdown-to-render spans, multiline diff provenance, streaming and every language/server combination need further edge testing. Ambiguous source navigation fails closed.
4. The npm-installed `pi-tab-focus` copy may not reflect the latest local/git bridge changes until released/updated. The wrapper launches the patched local `~/dev-trash/pi-tab-focus/src/index.ts` explicitly.
5. Virtual documents are read-only and in-memory. A `gd` action must resolve to an existing validated file; it will not open synthetic unsaved files in Neovim.

See `docs/REFACTOR_PLAN.md`, `SPEC.md` and `README.md`.