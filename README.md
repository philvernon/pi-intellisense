# pi-intellisense

**Editor-like code navigation in the existing Pi transcript.** Move to a symbol with `pi-tab-focus`, press `K` for LSP hover, or `gd` for its definition in Neovim. No model turn, separate code viewer or source edits.

This is a normal **Pi extension package**, not a separate CLI. Neovim does not need to be running: without a configured socket, the first navigation opens it in a tmux split and later jumps reuse that editor.

## Load the extensions

Requires Pi 1.3.0, Node 22.19+, a language server, and a source-aware `pi-tab-focus` checkout. The current local bridge changes are in `~/dev-trash/pi-tab-focus`; an older npm copy may lack them. Load only one copy of each extension.

For one session, from the project you want to inspect:

```sh
pi -e ~/dev-trash/pi-tab-focus -e ~/dev/repos/pi-intellisense
```

For persistent loading, use Pi's package mechanism:

```sh
pi install ~/dev-trash/pi-tab-focus
pi install ~/dev/repos/pi-intellisense
```

Then run normal `pi` inside tmux. Fullscreen is required for transcript navigation and is Pi's default. No wrapper script or prestarted Neovim is required. These installation commands change Pi settings; the implementation itself does not install or alter your global configuration.

For TypeScript/JavaScript, make `typescript-language-server` available on `PATH` and install TypeScript in the source workspace. Other default servers are `basedpyright-langserver`, `rust-analyzer`, `gopls`, and `lua-language-server`.

## Use it

1. Expand a `read` result if needed, or find a code block in an assistant explanation.
2. `Tab` focuses the transcript; `v` enters its existing visual cursor mode.
3. Move onto a symbol with Vim motions.
4. `K` opens an inline type/documentation overlay. `Esc` closes only the popup; `Tab` closes it and returns to the prompt.
5. `gd` opens a verified definition in Neovim. Multiple destinations use an inline picker.

Secondary supported gestures: `gr` references, `gD` declaration, `gi` implementation, `gy` type definition. Item-mode `K`, existing Vim motions, selections and yanks remain owned by `pi-tab-focus`.

## How source identity works

**Read results are automatic.** The exact persisted `read` tool-call ID supplies the path and offset. The returned code must still match disk. No filename needs to appear in the displayed result.

**The current workspace is the default context.** Point at a symbol in an assistant code block or ordinary transcript text. The extension asks the workspace language server for that symbol, then uses its real source file and position for hover or navigation. A unique match is automatic; multiple matches use the existing location picker. No annotations, prior file reads or extra model turn are required.

When a read result or an unchanged quote already identifies a real file position, that is used directly. Read-backed quotes allow common leading indentation changes. This is an optional fast path, not a requirement for workspace lookup.

Optional `source="src/client.ts" lines="42-43"` fence attributes still explicitly select a source range. This is an extension convention, not a Markdown standard. Lines are inclusive and 1-based, and the complete annotated range must match the file exactly, including indentation. Pi hides the attributes while retaining original Markdown; malformed or stale annotations fail locally.

If the language server cannot find the symbol in the workspace, the extension reports that directly. It does not silently query a fake isolated file and present `any` as project-aware information. Source code that exists only in chat is not expected to have a workspace definition.

## Neovim and configuration

Optional configuration lives at `~/.pi/agent/pi-intellisense.json` (or under `PI_CODING_AGENT_DIR`):

```json
{
  "timeoutMs": 5000,
  "provider": "standalone",
  "nvimSocket": "env:NVIM",
  "servers": {
    "typescript": { "command": "typescript-language-server", "args": ["--stdio"] }
  }
}
```

The default `env:NVIM` uses `PI_INTELLISENSE_NVIM`, then `NVIM`, if set to an absolute socket path; otherwise it launches Neovim lazily inside the current tmux server. Set `nvimSocket` to an absolute path to explicitly reuse a server, or to `auto` to ignore inherited socket variables and use an on-demand split.

A configured but broken socket produces an error, not an unexpected second editor. Outside tmux, configure an existing socket. An editor launched by this extension survives Pi shutdown so unsaved work is not discarded. If that editor exits, a later jump can launch a replacement. Reuse is session-scoped; after reloading Pi, explicitly configure its socket if you want to keep using that editor.

No `pi-tools`, Sidekick or Neovim configuration changes are made. Existing-socket navigation does not automatically switch host windows. The full Neovim/Sidekick embedding remains a separate integration check.

The optional `pi-lens-mcp` provider remains experimental. It starts a separate MCP process, does not share the Pi-loaded pi-lens pool, and does not support virtual snippets. Standalone stdio LSP remains the default.

## Limits

- Exact known-file mapping supports complete regions of at most 2,000 source lines. Otherwise, workspace lookup uses the identifier under the cursor; symbol coverage depends on the language server.
- Cold TypeScript/JavaScript lookup attaches an actual workspace source file to load its project. It does not index every separate project in a monorepo.
- Pi 1.3 renders tabs as three literal spaces; the mapper retains original UTF-16 source positions and uses Pi's own character-width calculation.
- Language servers must use UTF-16 positions. The client advertises UTF-16 only and rejects incompatible negotiation.
- Targets must be existing files inside the workspace. No guessed repository searches, source edits, completion application or arbitrary URI navigation.
- Native read aliases (`@`, `~`, Unicode spaces and file URLs) are normalized. Pi's special macOS filename fallbacks (AM/PM spacing, NFD and curly quotes) are not mirrored; those paths safely remain unmapped.
- The legacy `/intel` viewer and launcher binary have been removed. There is one native resolver/controller path, and the tests exercise it.

## Verify

```sh
npm run test:all
npm run build                 # real TypeScript check and extension import
npm run test:integration      # real TS LSP and isolated tmux/Neovim

# Also exercise real Pi transcript keys with the patched bridge:
PI_TAB_FOCUS_SOURCE=~/dev-trash/pi-tab-focus/src/index.ts npm run test:integration

cd ~/dev-trash/pi-tab-focus
npm test
npm run typecheck
```

Integration tests require the relevant executables on `PATH`. The Pi transcript tests run offline, use fixture sessions without model requests, and isolate their own tmux servers/configuration. They never kill an existing user editor/server.

[Specification](SPEC.md) · [Implementation plan](docs/REFACTOR_PLAN.md) · [Test contract](TEST_CONTRACT.md) · [Verification](VERIFICATION.md) · [Bridge changes](docs/UPSTREAM_BRIDGE.md)
