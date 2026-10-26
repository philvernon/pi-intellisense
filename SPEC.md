# Native transcript IntelliSense

The original Pi transcript is the code viewer. `pi-tab-focus` owns keyboard navigation; this extension resolves source identity, queries a local language server, renders inline overlays and opens verified locations in Neovim.

## Product contract

- `Tab` enters existing transcript focus, `v` enters its visual cursor, `K` shows an LSP hover next to that symbol.
- `Esc` dismisses only the hover. `Tab` dismisses and returns to the prompt. Pending responses cannot reopen UI after the invocation loses currency.
- `gd` opens a definition. `gr`, `gD`, `gi`, `gy` use the same location flow. Multiple destinations require an inline picker.
- If a Neovim socket is configured, reuse it. Otherwise lazily create a visible tmux split running Neovim, wait for RPC readiness and reuse it for this session.
- No model turn, source edit, second code viewer, competing input listener or global installation change.

## Workspace context by default

An identifier in the transcript is resolved against the current workspace through LSP `workspace/symbol`. The language server returns real file locations; one exact-name match is selected automatically and multiple matches use the normal location picker. Hover queries the selected real document. Definition jumps directly to the returned declaration. Other navigation requests use that document and position. No annotations or prior model reads are required, and chat text is not queried as an isolated fake file.

Fence language selects the server where available; otherwise a workspace source file supplies the language. Cold TypeScript/JavaScript lookup attaches one actual source file to load its configured project, preferring `src/` and skipping dependency/generated directories. A semantic-only TypeScript server avoids incomplete cold-start symbol results. Missing workspace symbols are reported directly; separate monorepo projects and symbol kinds a server does not index are not guessed.

Known source positions from native `read` results, optional annotations, and uniquely matching read-backed quotes remain fast paths. Quotes can remove a common leading indent while preserving real source columns. Ambiguous or stale unannotated read history does not prevent workspace lookup. Failed/truncated reads and generated notices never establish a source position. `before_agent_start` asks for ordinary language fences, with no metadata/read-history requirement.

## Optional source annotations

````markdown
```ts source="src/client.ts" lines="42-43"
const client = createClient();
await client.connect();
```
````

The convention is a language token, JSON-quoted `source` path, then a quoted `lines` range. Ranges are inclusive and 1-based; a single line may use `lines="42"`. Paths are candidates, not authority. The entire range must exactly match current source, normalizing CRLF line endings only. Indentation is significant. Malformed, missing, out-of-root or stale bindings never fall back to virtual documents.

`registerMarkdownTransformer` hides optional attributes only in assistant rendering; original session content remains intact.

## Single production mapping path

1. `src/index.ts` registers with the existing tab-focus event bus and supplies runtime adapters.
2. `src/native/provenance-resolver.mjs` resolves an original message fence or an exact persisted `read` call/result.
3. `src/native/transcript-source.ts` constructs complete display regions and maps the actual row/cell cursor to an identifier and UTF-16 source offset.
4. `src/native/native-controller.ts` sends the query, checks source/currency, presents an overlay or selects a destination.
5. `src/locations.mjs`, `src/neovim-launcher.mjs`, `src/neovim.mjs` validate the target and perform structured Msgpack-RPC navigation.

Read-result provenance uses `toolCallId`, Pi-normalized read paths and the actual `read` offset/limit. Raw output must match disk; native limit notices are reconstructed only from the actual call arguments. Number-like raw text is never guessed to be line labels. It never scans unrelated tool results for a matching line.

Fences without a verified read-context match and ordinary transcript identifiers use workspace-symbol lookup. A filename in prose is not treated as authoritative source metadata. Real-file destinations returned by LSP still require workspace validation.

Mapping requires the entire displayed code region to match contiguously and unambiguously. Assistant regions are confined to actual rendered fence boundaries in original block order; identical prose or another fence cannot borrow their source identity. Repeated source lines within one region are distinguished by row. Pi 1.3's three-space tab expansion is mapped back to original offsets, and widths use Pi's own `visibleWidth`. ANSI styling, wide glyphs and combining marks do not become source columns. Unsupported wrapping/truncation cannot establish an exact source position, but the visible identifier can still use workspace-symbol lookup. Lossless renderer-level wrapped spans and diffs remain future work.

## Bridge ownership and lifetime

The patched `pi-tab-focus` observer carries original assistant text, exact tool-call identity, rendered lines and their absolute start row. Its snapshot also includes session/item identity, transcript/layout revisions, visual/screen cursor and `isCurrent()`.

Hidden annotation changes invalidate the observer even if the rendered text is unchanged. Snapshot currency includes item, focus, cursor, reflow and viewport. Both extensions clean up on session replacement/shutdown. After a navigation target is resolved, a separate `isNavigationCurrent()` checks original item/source identity and explicit input/focus intent, allowing its own tmux split resize without cancelling the committed jump. It still cancels on new input, source changes, session exit or a newer request, and source hashes are revalidated through startup immediately before RPC. Foreign transient UI invalidates pending requests; `withNavigationPicker(run)` exempts only the operation's own location picker input. Startup/RPC errors remain visible after the split's own reflow while navigation intent is current. The real keyboard-owner tests live in `pi-tab-focus`, not a parallel adapter in this repository.

## Editor and safety policy

- Prefer explicit configuration, then configured environment sockets; `auto` forces an on-demand split.
- Never discover arbitrary running Neovim processes or launch a fallback after an explicit socket failure.
- Use the current tmux server and structured command arguments. Paths are RPC data, not interpolated shell or Ex code.
- Use a private socket directory, bounded startup and a single in-flight launch. A managed editor is replaced only when its exit is confirmed.
- Do not kill an editor on Pi shutdown or uncertain errors. Existing-editor host focus is not switched automatically.
- Canonicalize the workspace, constrain source/targets via realpath and revalidate file hashes around requests/navigation.
- Sanitize LSP display text and suppress cancelled/stale results.
- Advertise UTF-16 only and reject incompatible negotiated encodings. Concurrent cold requests await the same initialization promise; cancelling one waiter does not cancel other requests.

## Verification boundary

`npm run build` typechecks the source and imports the extension. Default and native suites exercise production components. Optional integration tests exercise real TypeScript LSP (including imported-method resolution from an unannotated quote), real tmux/Neovim, and real offline Pi transcript input for unannotated read-backed quotes, annotated fences and expanded reads.

See [VERIFICATION.md](VERIFICATION.md) for current results. Full Sidekick embedding, arbitrary renderer changes and wrapped/diff provenance are not certified.
