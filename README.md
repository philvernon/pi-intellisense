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

**Do not rely on the installed npm `pi-tab-focus` 1.0.2 for native hover:** it has not been patched. This change currently lives in the local `~/dev-trash/pi-tab-focus` checkout. Loading the npm copy *as well as* the patched checkout can cause competing transcript listeners. The local patch can be reapplied to a compatible copy with `node scripts/patch-tab-focus.mjs /path/to/pi-tab-focus` (the script is idempotent).

Your source project needs a configured language server. For TypeScript/JavaScript, install `typescript-language-server` and a supported `typescript` package (the tested setup used TypeScript 5.9). The server resolves TypeScript from the workspace. Other defaults in `src/runtime.mjs`: `basedpyright-langserver`, `rust-analyzer`, `gopls` and `lua-language-server`.

Optional `~/.pi/agent/pi-intellisense.json`:

```json
{
  "nvimSocket": "env:NVIM",
  "timeoutMs": 5000,
  "servers": {
    "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
  }
}
```

`PI_INTELLISENSE_NVIM` overrides `NVIM` when `nvimSocket` uses the environment setting. Neovim file navigation requires an existing socket; it does not start another editor.

## Inside the Pi transcript

1. Ask Pi to show or inspect source code **including its project-relative path**. The code needs to be recognisably file-backed and match current disk contents. The extension does not guess file identity from generated prose.
2. Press `Tab` to enter `pi-tab-focus` transcript navigation.
3. Press `v` to enter its visual cursor mode. Move with `j/k/h/l` and `w/b` to a code symbol.
4. Press `K` to show a floating LSP hover popup on top of the transcript. Press `Esc` to dismiss it without leaving transcript navigation.
5. Press `gd` to ask LSP for the definition, then open the result directly in the existing Neovim server.

Existing transcript item-mode `K`, yanks, selections, `gg`/`ge` and other Vim motions remain owned by `pi-tab-focus`. Supported secondary semantics include `gr`, `gD`, `gi`, `gy` and `gs`; not all secondary operations have been exercised against live servers.

The old `/intel` code viewer remains as a separate optional diagnostic fallback, **not** the intended interface.

## Sidekick / pi-tools

Your local Neovim configuration uses `folke/sidekick.nvim` and `~/dev-trash/pi-tools` with `tmux -L agents`. Neovim's LSP cannot operate directly on that terminal buffer, so code analysis still happens through the Pi extensions. Configure Sidekick's Pi command to launch the wrapper or both `-e` arguments. Explicitly set a Neovim socket in sessions where `NVIM` is not inherited.

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

The current tests pass (66 existing pi-intellisense, 24 native contracts, 67 patched pi-tab-focus). A real Pi 1.3.0 fullscreen PTY smoke test with a TypeScript code snippet showed the on-transcript `K` hover and `gd` successfully opened the correct file and cursor in an existing headless Neovim server. That smoke test **did not** exercise your complete Sidekick/tmux setup, every language or text wrapping/streaming edge case.

The optional test-only `/smoke-intel` command is in `test/fixtures/native-smoke.ts`. Load it as a third `-e` extension to inject a known file-backed code snippet without invoking a model.

[Specification](SPEC.md) · [Test contract](TEST_CONTRACT.md) · [Native test plan](docs/TEST_PLAN.md) · [Verification](VERIFICATION.md) · [Tab-focus patch](docs/UPSTREAM_BRIDGE.md)
