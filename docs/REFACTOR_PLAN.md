# Source-aware transcript refactor — implementation plan

## Agreed outcome

Code in Pi's existing transcript should support editor-like hover/navigation. Load a normal Pi extension, automatically identify `read` output, annotate unchanged assistant quotes with source-aware Markdown fences, and launch Neovim in a tmux split when needed. No separate viewer or required prestarted editor.

## Plan and implementation

1. **Establish original identity at the bridge.** Implemented in the local `pi-tab-focus` checkout: carry original assistant Markdown, exact tool-call ID, rendered lines and absolute origin. Invalidate snapshots when hidden metadata changes. Preserve the existing input owner.
2. **Unify provenance and cursor mapping.** Implemented: the live resolver uses the same display-region/UTF-16 mapper exercised by native tests. Verify complete file ranges and exact read offsets. Remove filename-prose scraping. Decline unprovable wrapping and ambiguity.
3. **Add annotated fences and automatic guidance.** Implemented: parse `source="..." lines="start-end"`, validate against disk, hide metadata through Pi's public rendering hook, and add guidance through `before_agent_start`. Ordinary generated fences retain in-memory hover.
4. **Remove abandoned product paths.** Implemented: remove `/intel`, its code pane, binary wrapper, duplicate controllers, test-only bridge/host/source adapters and obsolete tests. Keep useful assertions on the real implementation and upstream key owner.
5. **Make editor startup lazy.** Implemented: reuse configured sockets; otherwise launch `nvim --listen` in the current tmux server, wait for readiness, share concurrent launches and reuse the managed editor. Confirmed exits permit replacement; uncertain failures do not spawn duplicates or kill editors.
6. **Verify the actual integration.** Automated provenance/controller tests, real TypeScript checking, real LSP/tmux/Neovim tests and offline Pi terminal tests. Update setup and contracts to match the single production path.

## Verification gates

- A real annotated assistant message renders without attributes; `K` shows actual TS LSP hover; `gd` starts Neovim and opens the expected file/byte column.
- An actual expanded `read` result resolves through its persisted tool-call identity without an annotation or displayed filename requirement.
- A generated fence stays virtual; no synthetic file is created.
- Entire annotated ranges must match, not just the line under the cursor. Wrong/stale paths, traversal, symlinks, ambiguous regions, whitespace and unprovable wrapping fail closed.
- Tab/Escape, legacy motions, delayed responses, session replacement and source modifications retain dedicated coverage.
- Editor startup is inert until navigation; concurrent calls share launches; later jumps reuse the editor; explicit-socket errors never trigger another editor.

Current outcomes are recorded in [../VERIFICATION.md](../VERIFICATION.md).

## Explicit remaining work

Lossless renderer-level spans for wrapped/truncated code and diffs; full Sidekick/Neovim embedding; wider server/language validation; publication of the companion tab-focus changes. The optional pi-lens MCP provider remains experimental and does not share the in-process Pi pool. None is disguised as a completed integration gate.
