# pi-intellisense

Interactive, read-only LSP code navigation **inside Pi**, with Neovim as the destination editor. The extension uses local language servers, not model-generated hover text.

## Run

```sh
pi -e ~/dev/repos/pi-intellisense/src/index.ts --tui-mode fullscreen
```

Open a real source file using `/intel src/example.ts`. Alternatively use `/intel` to select a fenced code block or a `read` tool result in the active Pi conversation. `read` results with a recorded file path are verified against disk automatically; other snippets prompt for a corresponding source path. The extension verifies an exact contiguous match before enabling LSP queries for the selected snippet. Blocks without verifiable file provenance remain viewable but cannot query source LSP or jump to a guessed file.

### Keys in the IntelliSense code pane

| Key | Behaviour |
|---|---|
| `h j k l`, arrows, `w b`, `gg G`, `0 $` | Navigate code |
| `K` | Language-server hover |
| `gd` | Go to definition, opening target in running Neovim |
| `gD` | Declaration |
| `gi` | Implementation |
| `gy` | Type definition |
| `gr` | References picker |
| `gs` | Document symbols picker |
| `[d`, `]d` | Previous/next published diagnostic |
| `Ctrl-K` | Signature help (terminal permitting) |
| `Ctrl-Space` | Read-only completion list (terminal permitting) |
| `Esc` | Dismiss information/picker, then close pane |

Multiple locations are shown in a picker. Results cannot modify source code. Pi's prompt and transcript remain untouched.

### Prerequisites

- Pi with interactive TUI and Node >=22.18 (Pi loads `.ts` directly).
- A language server available in PATH. Defaults: `typescript-language-server --stdio` for TS/JS, `basedpyright-langserver --stdio` for Python, `rust-analyzer`, `gopls` and `lua-language-server` for corresponding languages. Nothing is auto-installed.
- Existing Neovim server socket. Either launch `nvim --listen /tmp/pi-intel.nvim` and `export PI_INTELLISENSE_NVIM=/tmp/pi-intel.nvim` before Pi, or run Pi in a Neovim terminal where `NVIM` names the socket.

Optional configuration: `~/.pi/agent/pi-intellisense.json`

```json
{
  "nvimSocket": "env:NVIM",
  "timeoutMs": 5000,
  "servers": {
    "typescript": {"command": "typescript-language-server", "args": ["--stdio"]},
    "python": {"command": "basedpyright-langserver", "args": ["--stdio"]}
  }
}
```

An explicit absolute pathname can replace `env:NVIM`. `PI_INTELLISENSE_NVIM` takes precedence over `NVIM` when using the environment setting. Neovim receives structured MessagePack-RPC calls, with paths passed as arguments, never shell interpolation. Location validation restricts jumps to the project root.

## pi-tab-focus integration status

**The standalone code pane works; direct `K`/`gd` on the existing `pi-tab-focus` transcript cursor still needs an upstream bridge.** This extension registers the proposed `pi-intellisense:register:v1` event and implements its consumer. The published `pi-tab-focus` does not yet emit the required source-position snapshot, so loading both extensions will **not** enable `K` or `gd` directly in the original transcript. Its existing focus, yank and navigation remain unchanged. Use `/intel` in the meantime. See [SPEC.md](SPEC.md) sections 2–4 for the bridge contract and required upstream changes.

## Development

```sh
npm test
npm run build
```

The tests cover fenced blocks, source verification, UTF-16/UTF-8 conversion, keyboard grammar, LSP lifecycle, real JSON-RPC framing, Neovim MessagePack framing and fake Pi command/UI integration. `npm run build` syntax-checks and loads the extension entrypoint. Tests do **not** prove a live Pi/Neovim/LSP end-to-end session; manual smoke testing is still required.

[Specification](SPEC.md) · [Contract interfaces](TEST_CONTRACT.md) · [Verification](VERIFICATION.md) · [Optional alternative viewer design](docs/SPEC.md)