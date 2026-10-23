# Native transcript implementation verification — 23 October 2026

- `npm test` in `pi-intellisense`: **66/66 passing** (legacy + live-source verification).
- `npm run test:native`: **24/24 passing**.
- `npm run build`: passing, entrypoint loads.
- `npm test` in patched `~/dev-trash/pi-tab-focus`: **67/67 passing**, including actual tab-focus visual-cursor `K`/`gd` dispatch harness.
- `npm run typecheck` in patched tab-focus: passing.
- **Real Pi 1.3.0 fullscreen PTY smoke test:** loaded patched tab-focus, pi-intellisense and a test-only custom-message extension. The snippet was displayed in the original transcript; `Tab → v → Vim motions → K` displayed a true TypeScript language-server hover popup (`function greet(name: string): string`) over the transcript.
- **Real Neovim RPC smoke test:** started `nvim --headless --listen` at a temporary Unix socket, then pressed `Esc` and `gd` on the transcript symbol. Neovim reported `test/fixtures/source.ts`, line **2**, column **17**. No separate `/intel` pane was opened.
- **Limits:** run used a test-generated source snippet and headless Neovim, not the user's Sidekick-hosted GUI/terminal. The installed npm `pi-tab-focus` 1.0.2 remains unmodified; the patched local `~/dev-trash/pi-tab-focus` checkout is launched via the new wrapper. Unsupported/generated snippets without trustworthy file paths intentionally show a source mapping warning. Not all wrapping/streaming/alternate-language cases have been validated.
- All changes remain **local and uncommitted**. No public GitHub push has been made.

See `SPEC.md`, `README.md` and `docs/UPSTREAM_BRIDGE.md`.
