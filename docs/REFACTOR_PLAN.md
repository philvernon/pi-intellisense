# Transcript IntelliSense v2 — plan and implementation gates

Date: 23 October 2026. **Plan written before v2 implementation; the implemented results are recorded below.** Baseline has been saved publicly before changes:
- pi-intellisense `de1d652`
- pi-tab-focus `a5bdb55`

## Implementation status (23 October 2026)

- **A / focus: implemented and live-tested.** The hover overlay handles Tab by closing itself and signaling the existing tab-focus owner to return to Pi's prompt. Escape only closes the popup. A frozen invocation exposes `isCurrent()`; it becomes false on mode, cursor, transcript or viewport changes, preventing late LSP results. Pending `g` prefixes are cleared when leaving visual mode.
- **B / provenance: implemented initial safe tiers.** `src/native/provenance-resolver.mjs` uses recorded `read` tool-call IDs and paths, checks numbered tool-result lines against the current file and maps to UTF-16. Existing exact line verification remains a fallback. Explicit fenced languages produce read-only virtual sources; standalone TypeScript LSP hover was live-tested without creating a source file. Ambiguous and unverified locations do not jump. Full rendered-wrapped-span mapping remains deferred.
- **C / provider abstraction: implemented, pi-lens MCP experimental.** `src/providers/index.mjs` exposes standalone and selectable pi-lens MCP providers, with read-only operation allowlists and framed newline JSON-RPC process tests. The installed pi-lens 4.4.3 MCP executable failed a real query due to a missing `typebox` dependency; the provider therefore remains opt-in and is not certified against a real pi-lens runtime. It does *not* share the existing Pi-loaded pi-lens in-process pool.
- **D / navigation: retained and hardened.** Definition jumps revalidate the source hash before opening Neovim; real Pi / real TypeScript LSP / existing Neovim headless RPC smoke test passed.
- **E / verification: complete for initial P0.** 75 existing + 28 native IntelliSense tests, 70 patched tab-focus tests, build and typecheck pass. A real Pi fullscreen PTY confirmed inline file-backed hover + gd, virtual fenced TypeScript hover and Tab returning from a popup to an editable prompt. Real Sidekick/tmux-hosted Neovim user session and complex wrapped-output mapping are not yet tested.

## Problem statement

The product remains native LSP hover (`K`) and definition (`gd`) **inside the existing Pi chat transcript**. The current baseline works on a deliberately annotated live TS example, but has two structural defects:

1. **Focus ownership**: capturing hover overlays swallow Tab, and late LSP results can reopen a popup after the user has returned to the prompt. Pi tab-focus, a popup and Pi itself must agree on focus state.
2. **Source identity**: text in a Pi message is not a source URI. The baseline scrapes filenames from rendered text and requires exact complete lines, so everyday tool results and generated snippets often produce a generic “Source mapping unavailable” warning. The transcript renderer may wrap, decorate or truncate the text, causing loss of offset information.

Separately, the implementation directly owns an independent LSP-server pool despite an existing installed `pi-lens` extension (v4.4.3) with a language-server pool, a published `lsp_navigation` tool and an experimental MCP mirror.

## Scope and work packages

### A. Focus contract — P0

- Pi-tab-focus remains the **only owner** of transcript keyboard dispatch, and it retains its historical item-mode K/gg/ge/yank bindings. No second `onTerminalInput` listener.
- Pi-tab-focus exposes a transient `pi-tab-focus:focus-state:v1` event when focus/visual cursor/reflow change and accepts `pi-intellisense:return-to-editor:v1` for the explicit Tab transition from a capturing overlay.
- The popup consumes `Esc` (dismiss only) and `Tab` (dismiss **and** return to prompt); both are tested in a real Pi PTY.
- Each invocation includes a `isCurrent()` validation callback or an equivalent token. The backend checks it before issuing a request and immediately before displaying an overlay or navigating; session/visual focus, source/layout revision, cursor and viewport changes invalidate results.
- `Tab` while LSP is pending must cancel its result. A popup opening after focus exit is a release-blocking bug.
- Test both Pi keybinding and Neovim/Sidekick input modes; the Neovim normal-mode `<Tab>` mapping is a separate outer interception layer.

### B. Provenance/source model — P0

- Prefer structured tool-call provenance: associate `read` toolCall ID with path in the actual Pi `sessionManager.getBranch()` records; verify bytes/line-number labels against disk; do not infer a trusted location from assistant prose alone.
- For fenced code blocks, use **original session message text** and code-block identity, language and line offsets. Use the stable tab-focus item semantic key to constrain candidate message and displayed snippet; no path search across unrelated sessions.
- For file-backed snippets, map rendered terminal cells to exact source UTF-16 offsets, including Unicode/tab and Markdown indentation; reject ambiguous lines, stale content, truncation or unprovable wrapped segments. Do not navigate when mapping is uncertain.
- For generated snippets with a supported explicit fence language, construct a read-only session-scoped virtual document. If backend supports virtual URI, allow hover; only allow navigation to a verified, trusted returned file URI. If not supported, report `virtual-document-unsupported` (not a generic source error).
- Return typed `Resolution` states: `verified-file`, `virtual-document`, `source-unknown`, `cursor-not-symbol`, `ambiguous`, `stale-source`, `wrapped-unmappable`. UI shows a short accurate message and optional binding guidance.
- Keep existing, exact full-line matching as a conservative fallback for readable code in the currently visible transcript.

### C. Provider abstraction — P1

- Define a `CodeIntelligenceProvider` independent of Pi/UI: `query({kind,uri,position,signal,...})`, `supportsVirtualDocuments`, `close`.
- Keep an independent stdio-LSP provider as reliable default for existing live compatibility.
- Add a **separately selectable** pi-lens MCP provider, using its shipped `pilens_lsp_navigation` over the MCP transport, with concrete contract and integration tests. Never call a Pi *agent tool* from UI or spawn it through a model turn. Restrict MCP operations to read-only hover/definition/references; default must never mutate source.
- Do not pretend MCP reuse means sharing `pi-lens`'s warm *in-process* pool: the separate MCP process has its own clients. A genuine shared pool needs a supported native Pi-lens UI service/event API; mark as later upstream work and avoid importing undocumented dist chunks.
- If the pi-lens MCP server fails or is slow, show an actionable error; only fall back to stdio if explicitly configured. Avoid side effects on an agent's main pi-lens state.

### D. Neovim and runtime — P1

- Continue structured Msgpack-RPC into existing Neovim socket. No shell-escaped path interpolation and no nested Neovim.
- Revalidate file/version and root before source or destination navigation. Keep multi-location picker over transcript.
- Sidekick (tmux `-L agents`) must support explicit socket configuration; focus switching from Sidekick's terminal back to the current Neovim window is separate from opening a file and optional.

### E. Testing gates

1. Unit/state machine: popup Tab/Esc, focus change while request pending, duplicate input listeners, K/gd unchanged, Pi/Sidekick focus input boundary.
2. Source fixtures: read tool result **without filename in displayed text**, assistant fence with/without path, generated virtual snippet, wide chars, tabs, stale file, duplicates and wrapped line rejection. No wrong-file jumps.
3. Provider contract: stdio LSP plus pi-lens MCP (real `tools/list` / `tools/call` exercise where feasible) and one-error/no-model semantics.
4. Live Pi 1.3.0 PTY: original transcript K overlay, Tab returns editor, escape dismiss, delayed-response cancellation, gd Neovim and no new code viewer.
5. Full `pi-intellisense` and `pi-tab-focus` regression suites + typecheck/build, then commit and push both repositories.

**Non-goals now:** using Neovim as the transcript buffer, auto-editing generated snippets, automatically repairing source code, changing pi-tools or pi-lens internals, pinning source identity using unsafe first-string-symbol search.

## Implementation order and fallback policy

1. Fix P0 keyboard/focus failures.
2. Add structured provenance and typed resolution states, with virtual-document handling that fails honestly when unsupported.
3. Implement provider interface; integrate pi-lens MCP as optional without changing default.
4. End-to-end test and update documentation; commit/push.
5. Future upstream PR: pi-lens native UI service sharing its real existing warm pool (prefer to separate MCP process when supported).

All P0 failures block completion claims; optional provider work is separately reportable if the installed MCP interface does not support a required operation.