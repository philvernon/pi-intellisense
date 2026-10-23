# pi-intellisense

**Native LSP hover and definition inside the original Pi transcript.** Uses the existing `pi-tab-focus` visual cursor, a positioned Pi overlay and an existing Neovim instance. No separate code viewer is involved in the `K`/`gd` path.

## Start

Run Pi in the project whose code you want to navigate:

```sh
cd ~/dev/repos/your-project

# Use a real Neovim server. Start this in another terminal:
nvim --listen /tmp/pi-intel.nvim

# In the shell that launches Pi:
export PI_INTELLISENSE_NVIM=/tmp/pi-intel.nvim
~/dev/repos/pi-intellisense/bin/pi-intellisense
```

The wrapper loads both **patched local** `~/dev-trash/pi-tab-focus/src/index.ts` and `~/dev/repos/pi-intellisense/src/index.ts` using `pi -e`, with `--tui-mode fullscreen`. To launch manually:

```sh
pi --tui-mode fullscreen \
  -e ~/dev-trash/pi-tab-focus/src/index.ts \
  -e ~/dev/repos/pi-intellisense/src/index.ts
```

**Do not rely on the installed npm `pi-tab-focus` 1.0.2 for native hover:** it may not yet include the GitHub bridge. Pull the current `main` branch in your local `~/dev-trash/pi-tab-focus` checkout, which this wrapper loads directly. Loading the npm copy *as well as* the local checkout can cause competing transcript listeners.

Your source project needs a configured language server. For TypeScript/JavaScript, install `typescript-language-server` and a supported `typescript` package (the tested setup used TypeScript 5.9). The server resolves TypeScript from the workspace. Other defaults in `src/runtime.mjs`: `basedpyright-langserver`, `rust-analyzer`, `gopls` and `lua-language-server`.

Optional `~/.pi/agent/pi-intellisense.json`:

```json
{
  "nvimSocket": "env:NVIM",
  "provider": "standalone",
  "timeoutMs": 5000,
  "servers": {
    "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
  }
}
```

`PI_INTELLISENSE_NVIM` overrides `NVIM` when `nvimSocket` uses the environment setting. Neovim file navigation requires an existing socket; it does not start another editor.

## Inside the Pi transcript

1. Ask Pi to show or inspect code. **Structured `read` tool results** can identify their file from the saved tool-call path, even when the displayed text lacks a filename. Assistant snippets with file paths must match disk. **Generated fenced code** with a supported language can use a read-only, in-memory virtual LSP document for hover, without saving a file.
2. Press `Tab` to enter `pi-tab-focus` transcript navigation.
3. Press `v` to enter its visual cursor mode. Move with `j/k/h/l` and `w/b` to a code symbol.
4. Press `K` to show a floating LSP hover popup on top of the transcript. Press **`Esc` to dismiss and remain in the transcript**, or **`Tab` to dismiss and return to the prompt editor**. Late hover replies after leaving transcript mode are ignored.
5. Press `gd` to ask LSP for the definition, then open the result directly in the existing Neovim server.

Existing transcript item-mode `K`, yanks, selections, `gg`/`ge` and other Vim motions remain owned by `pi-tab-focus`. Supported secondary semantics include `gr`, `gD`, `gi`, `gy` and `gs`; not all secondary operations have been exercised against live servers.

Unmapped or stale file-backed snippets do not trigger guessed navigation. The UI distinguishes missing source, non-symbol cursor and ambiguity. For generated virtual documents, local hover works with compatible standalone language servers; a `gd` jump only opens a verified, existing file returned by LSP. The old `/intel` code viewer remains a diagnostic fallback, **not** the intended interface.

## Code intelligence providers

The native transcript and source-resolution code is independent of its LSP backend. The default `"provider": "standalone"` runs configured local language servers via stdio, now also handling unsaved virtual code in memory where a server supports it.

There is an optional experimental `"provider": "pi-lens-mcp"` that calls the installed pi-lens `pilens_lsp_navigation` MCP tool directly from the UI (never via the AI model). To try it, set `provider` in `~/.pi/agent/pi-intellisense.json`, optionally supplying an absolute `"piLensServer"` path to `dist/mcp/server.js`. It is **not the default**: the pi-lens MCP process uses its own LSP clients rather than sharing Pi's existing pi-lens pool, does not accept virtual documents, and the locally installed pi-lens 4.4.3 MCP process currently fails to start due to a missing `typebox` dependency. The read-only transport and protocol are covered by mock-process tests; the real pi-lens MCP backend has **not** passed a live query.

The preferred long-term integration is an upstream supported, in-process pi-lens UI service API so Pi doesn't start duplicate server pools. It is not currently available as a verified contract.

See [the v2 design and rollout plan](docs/REFACTOR_PLAN.md).

## Sidekick / pi-tools

Your local Neovim configuration uses `folke/sidekick.nvim` and `~/dev-trash/pi-tools` with `tmux -L agents`. Neovim's LSP cannot operate directly on that terminal buffer, so code analysis still happens through the Pi extensions. Configure Sidekick's Pi command to launch the wrapper or both `-e` arguments. Explicitly set a Neovim socket in sessions where `NVIM` is not inherited.

For Pi running inside the **existing** Neovim/Sidekick instance, prefer using that Neovim as the RPC server rather than starting a second editor. Check `:echo v:servername` or run `:echo serverstart("/tmp/pi-intel.nvim")` inside the host Neovim, then configure Pi with the resulting socket path. Pi uses that already-running editor for `gd`; no process or pane switching is implicit.

No changes have been made to your `pi-tools` repository or Neovim configuration.

## Verification

```sh
cd ~/dev/repos/pi-intellisense
npm run test:all
npm run build

cd ~/dev-trash/pi-tab-focus
npm test
npm run typecheck
```

The current suites pass: **75 existing pi-intellisense tests, 28 native contract tests and 70 patched pi-tab-focus tests**, plus build/typecheck. Real Pi 1.3.0 fullscreen PTY tests confirmed file-backed hover and `gd` to an existing Neovim socket, generated virtual TypeScript hover and `Tab` from an open overlay back to the prompt editor. These smoke tests **did not** exercise your complete Sidekick/tmux setup, every language or text wrapping/streaming edge case.

The optional test-only `/smoke-intel` and `/smoke-virtual` commands is in `test/fixtures/native-smoke.ts`. Load it as a third `-e` extension to inject a known file-backed code snippet without invoking a model.

[Specification](SPEC.md) · [V2 plan](docs/REFACTOR_PLAN.md) · [Test contract](TEST_CONTRACT.md) · [Native test plan](docs/TEST_PLAN.md) · [Verification](VERIFICATION.md) · [Tab-focus patch](docs/UPSTREAM_BRIDGE.md)