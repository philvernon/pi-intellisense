# pi-tab-focus bridge integration checklist

The `pi-intellisense` extension supports registration on the Pi extension event bus. The published `pi-tab-focus` extension must explicitly cooperate to make keybindings available *inside its existing visual navigation*.

Required changes in `philvernon/pi-tab-focus`:

1. Listen to `pi-intellisense:register:v1` and `pi-intellisense:unregister:v1` via `pi.events.on`. Keep a session-scoped `invoke(operation,snapshot)` callback.
2. In the **existing** `ctx.ui.onTerminalInput` visual branch, parse `K`, `gd`, `gD`, `gi`, `gy`, `gr`, `gs`, `[d`, `]d`, `Ctrl-K` and `Ctrl-Space`. Consume only supported semantic gestures; leave `gg`, `ge`, yanks, find motions, links and selection intact. `K` in item focus must continue selecting the previous transcript item.
3. Expose a **source-position aware** snapshot with `version:1`, `sessionId`, `semanticKey`, `sourceRevision`, `visualCursor`, `renderedLines`, item range and `codeRegions` containing *verified* SourceMap DisplaySpans. Do not derive a source filename or LSP position from rendered Markdown without validating the original file bytes and the span against the layout revision.
4. Emit `pi-tab-focus:availability:v1` with the current session ID after its visual navigation hooks are installed, to cover either extension load order. Dispose handlers on `session_shutdown` and reset them on reload.
5. Maintain upstream `vim-navigation.ts`, `transcript-observer.ts` and `index.ts` tests for all legacy motions and reflow/resize cases.

The receiving extension is implemented in `src/bridge/register.ts` and `src/index.ts` (`bridgeAction`), with gesture conformance in `src/bridge/gestures.ts` and tests in `test/bridge.test.mjs` and `test/gestures.test.mjs`.

**Do not emit empty or guessed `codeRegions` merely to make a gesture appear handled.** Native transcript LSP/navigation stays disabled until exact source mapping can be supplied. The working `/intel` code pane is the verified-code fallback.
