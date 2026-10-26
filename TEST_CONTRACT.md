# Implementation and acceptance contracts

[SPEC.md](SPEC.md) defines the product. Tests exercise the single native transcript implementation; the standalone viewer and test-only alternative controllers/adapters have been removed.

## Production coverage

- `test/blocks.test.mjs`: fence extraction, candidate metadata, malformed annotation rejection, hidden attributes and streaming openings.
- `test/provenance-resolver.test.mjs`: actual resolver with temporary files; full-range validation, exact read identity/offset, Pi-normalized paths, raw output/argument-verified limit notices, actual fence boundaries, automatic read-backed quote recovery, common-indent/UTF-16 mapping, duplicate-location ambiguity and alias deduplication, stale-content refusal, safe paths, virtual fences, Pi-consistent widths and wrapped-region rejection.
- `test/native/source-map.contract.test.mjs`: the display-region mapper called by the live resolver; exact UTF-16 cursor positions, source versions, revisions, ambiguity and non-symbol rejection.
- `test/pi-entry.test.mjs`: real extension registrations, prompt section, Markdown hook, session lifecycle and native dispatch through an actual framed mock-LSP child process. No separate viewer or model tools.
- `test/native/native-controller.contract.test.mjs`: workspace symbol lookup, real-document hover, direct workspace definition handoff, ambiguous symbol picker, workspace misses, cancellation and source revalidation.
- `test/native/inline-hover.contract.test.mjs`: geometry, sanitization, keyboard ownership and Tab/Escape.
- `test/neovim-launcher.test.mjs`: inert construction, socket reuse, lazy tmux split, concurrent startup, bounded readiness, confirmed-exit recovery, ambiguous failures and shell-free paths.
- `test/neovim.test.mjs`, `test/wire.test.mjs`: structured RPC and real socket framing, UTF-8 byte columns and literal path handling.
- `test/runtime.test.mjs` and `test/lsp.test.mjs`: shared cold-start initialization, independent cancellation, failure/close races, workspace symbols/resolution, automatic language selection and project attachment, UTF-16-only negotiation and real framed subprocesses.
- Other default suites retain provider, coordinate and destination-validation coverage.

Real transcript key dispatch belongs to `pi-tab-focus/src/tests/index.test.ts`. That repository also tests original source text, exact tool identity and hidden-metadata invalidation. There is no parallel keyboard-owner implementation here.

## Live process/terminal coverage

`test/integration/runtime.test.mjs` uses real TypeScript LSP and an isolated tmux server with Neovim. `test/integration/transcript.test.mjs` uses real Pi with saved fixture sessions, no model requests, and the companion bridge supplied through `PI_TAB_FOCUS_SOURCE`.

The transcript cases cover plain workspace-only assistant code with no reads or language tag, unannotated read-backed quotes, annotated code and expanded raw read output. They assert real `K` hover, lazy `gd` launch, and the actual Neovim buffer/cursor. A separate real-LSP regression recovers context for a usage-only quote and resolves an imported class method's type and definition in another file, rather than `any`. Servers and configuration are isolated from user sessions.

```sh
npm run test:all
npm run build
PI_TAB_FOCUS_SOURCE=/path/to/pi-tab-focus/src/index.ts npm run test:integration
```

`test/integration/workspace.test.mjs` additionally verifies cold workspace lookup with explicit and automatically selected language. No model reads or annotations are involved.

Without `PI_TAB_FOCUS_SOURCE`, only the four Pi-terminal cases skip; real LSP/tmux/Neovim runtime tests still run. Integration commands require installed executables and should be run deliberately.

## Acceptance boundary

Passing unit suites is not a claim of full Sidekick support, universal wrapped spans or every language. Current measured outcomes and limitations belong in [VERIFICATION.md](VERIFICATION.md).
