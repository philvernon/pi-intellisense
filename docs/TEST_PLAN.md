# Native transcript acceptance test plan

The executable coverage inventory is [../TEST_CONTRACT.md](../TEST_CONTRACT.md); measured results are [../VERIFICATION.md](../VERIFICATION.md).

## Automated gates

1. `npm run test:all`: source-annotated and virtual fences, exact read-result provenance, production source mapper, controller/UI state, providers, LSP/RPC and lazy editor lifecycle.
2. `npm run build`: real TypeScript checking and extension entry import.
3. `npm run test:integration`: real TS LSP plus a clean Neovim launched inside an isolated tmux server.
4. `PI_TAB_FOCUS_SOURCE=/path/to/pi-tab-focus/src/index.ts npm run test:integration`: also run real Pi terminal cases for annotated assistant code and expanded `read` results. No provider requests or user tmux sessions are used.
5. In the companion tab-focus checkout: `npm test && npm run typecheck` for the actual input owner and source-aware observer.

## Manual acceptance

- Start normal Pi inside tmux with each extension loaded once, with no Neovim open.
- Expand a code `read` result; `Tab`, `v`, move to a symbol, `K`. Confirm the tooltip overlaps the original transcript.
- `Esc` closes only the tooltip. Motions/yanks remain usable. `Tab` from an open hover returns to the prompt.
- `gd` opens a tmux split with the correct file, line and byte column. Return to Pi and jump again; no duplicate editor.
- Repeat with an assistant quote using `source`/`lines`; attributes stay hidden. Ordinary generated code uses virtual hover, not guessed file identity.
- Edit a quoted line on disk, point at whitespace, resize to wrap a line or present ambiguous duplicate blocks. Navigation must decline rather than guess.
- With a configured existing socket, navigate without creating a split or switching host focus. With a broken configured socket, report the error without launching another editor.

## Remaining matrix

Full Sidekick embedding and pi-vim outer-mode interactions, alternative language servers, narrow/streaming viewport cases, renderer-level wrapped spans and diff provenance require additional coverage. Wrapped/truncated mappings currently fail closed; those cases are not claimed to be navigable.
