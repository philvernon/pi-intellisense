# Companion pi-tab-focus bridge

The companion changes are in the local `~/dev-trash/pi-tab-focus` checkout. Load that package through Pi's normal extension mechanism alongside this package. The old wrapper binary has been removed. Do not also load an older npm copy; published bridge compatibility is not assumed.

## Ownership

`pi-tab-focus` remains the sole transcript keyboard owner. It preserves item-mode `K`, Vim motions, selections, yanks and modal input. In visual mode it dispatches only registered semantic actions. This repository no longer carries a second reference implementation of that dispatcher.

`pi-intellisense` registers through `pi-intellisense:register:v1`, unregisters with `pi-intellisense:unregister:v1`, and handles load order through `pi-tab-focus:availability:v1`. Registered actions are hover, definition, references, declaration, implementation and type definition. It does not advertise unimplemented diagnostic/completion/symbol UI.

## Source-aware snapshot additions

The observer exports:

- `sourceText`: original assistant text from Pi's message component, before Markdown transformers hide annotations.
- `toolCallId`: exact persisted call identity for tool components.
- `renderedLines`: original styled component lines.
- `renderedStartRow`: absolute transcript row corresponding to the first rendered line, before leading blank lines are trimmed.
- Existing session/item identity, transcript/layout revisions, visual/screen cursor and strict `isCurrent()`.
- `isNavigationCurrent()`: original item/source identity and a separate explicit-input/focus epoch, allowing a committed navigation to survive layout changes caused by opening its own editor split.
- `withNavigationPicker(run)`: scoped ownership for IntelliSense's location picker, so its own selection input does not invalidate the request while unrelated transient UI does.

`src/transcript-observer.ts` captures original text when accepting a render and compares it when deciding whether content changed. Changing only a hidden source annotation therefore invalidates a pending snapshot. The absolute origin includes the transcript container's offset; rendered prefixes do not become source offsets.

Pi 1.3's assistant component stores the original message in `lastMessage`; this is a private compatibility boundary in the observer. The bridge's unit tests and real Pi terminal integration tests cover the currently installed runtime. A future component change must fail to unknown source, not guess provenance from rendered prose.

## Focus and lifecycle

`isCurrent()` checks item/cursor/focus epoch, transcript revision, layout and scroll position. The IntelliSense controller suppresses stale responses. Once a target is resolved, `isNavigationCurrent()` permits its own editor-split reflow but still rejects new input, changed source identity or lost focus; the controller also checks session/request lifetime and revalidates source hashes immediately before navigation RPC. An open hover handles Escape locally and emits `pi-intellisense:return-to-editor:v1` on Tab. Tab-focus then returns ownership to the prompt. Session replacement unregisters old handlers; shutdown aborts pending work and closes active overlays without killing Neovim.

## Verification

In the companion checkout, run `npm test` and `npm run typecheck`. In this repository:

```sh
PI_TAB_FOCUS_SOURCE=~/dev-trash/pi-tab-focus/src/index.ts npm run test:integration
```

Both real Pi cases use source-aware snapshots from the actual companion extension, real TS hover, and lazy Neovim launch. They do not use a test-only bridge adapter. Publishing/installing the companion changes is still separate from changing this local checkout.
