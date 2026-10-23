> NOTE: Alternative standalone code-pane test plan, not the authoritative test inventory. See ../SPEC.md, ../TEST_CONTRACT.md and ../test/ for current pi-tab-focus-native RED tests. Some proposed files below do not exist.

# Supplemental test plan and traceability

**Primary specification and contracts are [../SPEC.md](../SPEC.md) and [../TEST_CONTRACT.md](../TEST_CONTRACT.md).** The tests described here exercise additional reusable extraction, path, LSP, RPC and lifecycle seams. Where a requirement differs, the primary in-transcript `pi-tab-focus` bridge contract takes precedence. No separate code viewer is required for v1.

Status: **red tests written before implementation**. Runner: Node `node:test`, `node:assert/strict`; no dependencies or live services needed for unit tests. Tests import intentionally unimplemented `src/*.mjs` entry points. Failure is expected until production code is added.

## Priorities and coverage

| ID | Priority | Contract | Automated file |
| --- | --- | --- | --- |
| BL-01 | P0 | fenced block extraction, language, ordering, exact text | `test/blocks.test.mjs` |
| BL-02 | P0 | unclosed and nested fences, branch-only ordering | `test/blocks.test.mjs` |
| PR-01 | P0 | source verification through exact contiguous text | `test/provenance.test.mjs` |
| PR-02 | P0 | stale, ambiguous, fabricated, symlink-escaped and truncated sources fail closed | `test/provenance.test.mjs` |
| PO-01 | P0 | LSP UTF-16 → Neovim UTF-8 byte conversion | `test/positions.test.mjs` |
| PO-02 | P0 | tabs, wide characters and combining marks in hit testing | `test/positions.test.mjs` |
| LO-01 | P0 | Location and LocationLink variants, dedup and null | `test/locations.test.mjs` |
| LO-02 | P0 | file URL decoding, trusted roots and traversal | `test/locations.test.mjs` |
| NV-01 | P0 | explicit socket, injection-safe RPC call, row and byte column | `test/neovim.test.mjs` |
| NV-02 | P0 | missing socket or editor error does not open a new editor | `test/neovim.test.mjs` |
| LS-01 | P0 | initialize, opened document, negotiated capabilities, correct requests | `test/lsp.test.mjs` |
| LS-02 | P0 | null results, cancellation, timeout, shutdown | `test/lsp.test.mjs` |
| CT-01 | P0 | hover and definition at selected origin location, never invoke LLM | `test/controller.test.mjs` |
| CT-02 | P0 | superseded request, branch change, cancellation and disposal | `test/controller.test.mjs` |
| PI-01 | P1 | extension commands only in TUI; branch-aware picker; Pi adapter type pin | manual plus integration |
| PI-02 | P1 | keyboard nav, mouse fullscreen-only, overlays and resize | manual plus component harness |
| IN-01 | P1 | real TypeScript server hover/definition | opt-in integration |
| IN-02 | P1 | real Neovim `--listen` opens existing target, Unicode cursor exact | opt-in integration |
| SEC-01 | P0 | no shell interpolation, no out-of-root file, no untrusted code execution | `test/neovim.test.mjs`, `test/locations.test.mjs` |

## Test double interfaces

- `FileSystem`: `realpath(path):Promise<string>`, `readFile(path, 'utf8'):Promise<string>`. Use a deterministic map in tests; no actual filesystem mutation.
- `LspTransport`: `request(method, params, options?):Promise<unknown>`, `notify(method, params):Promise<void>|void`; fake records calls and simulates delays.
- `NeovimRpc`: `request(method, params):Promise<unknown>`; fake records message shape. Do not spawn shell processes.
- `Controller`: `createNavigationController({lsp, neovim, getGeneration, getSnapshot, report})`, `hover(selection)`, `definition(selection)`, `dispose()`. Selection has `uri`, `position`, `generation`, `snapshotId`, `root`.
- Pure helpers receive plain records and optional injected filesystem. Returned objects are serializable; never hide failure by making up a location.

## Red/green process

1. Baseline: `npm test` must discover every test and report failures against explicit unimplemented functions. This baseline is the TDD starting point, **not** a pass.
2. Implement pure contracts and run `npm run test:core`; ensure all P0 safety cases pass before wiring Pi/Neovim.
3. Implement the LSP and Neovim adapters against fake transports, then run `npm test`. Each implemented contract must eventually turn green. Record compatible Pi, Neovim, Node and server versions.
4. Add opt-in integration tests behind `PI_INTELLISENSE_INTEGRATION=1`, using temporary workspace and Neovim socket and real language server binaries. Never require the user's personal Neovim session during CI.
5. Manually validate keyboard-only normal/fullscreen TUI, hover-on-mouse in fullscreen, screen resize, session switching and cancellation in actual Pi.

## Mandatory scenarios not entirely covered by pure tests

- Actual Pi startup, extension hot reload, branch switch, `ctx.mode` different from `tui`.
- Mouse reporting differences: Kitty, tmux, SSH and regular-mode terminal selection.
- Real LSP server failures/restart, project-aware imports, virtual unsaved document support and diagnostics.
- LSP position-encoding negotiation beyond UTF-16 and server-initiated client requests.
- Neovim modified buffers, terminal focus, disconnected sockets and live line content differing from the disk snapshot.
- End-to-end race: select A, hover A, select B, receive A's response, confirm no outdated UI or navigation.

## Release gates

All P0 unit tests green, two real end-to-end paths green (one anchored snippet and one generated/virtual snippet where supported), security checks green, Pi adapter verified against pinned installed version, no unbounded child processes or abandoned RPC connections. Product capabilities in the README must not claim success before these gates.