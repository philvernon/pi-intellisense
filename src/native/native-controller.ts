import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLocations, normalizeHover } from "../lsp/normalize.ts";
import { showInlineHover, type NativeUI } from "./inline-hover.ts";
import type { Snapshot, IntelliSenseAction } from "../bridge/register.ts";
import type {
  SourceAnchor,
  WorkspaceSymbolQuery,
} from "./transcript-source.ts";
import { placeHoverOverlay, type OverlayGeometry } from "./overlay-geometry.ts";
import {
  truncateToWidth,
  visibleWidth,
  matchesKey,
  Key,
} from "@earendil-works/pi-tui";
import { stripAnsi, type Position } from "../positions.ts";

import type {
  SourceResolution,
  UnmappedReason,
} from "./provenance-resolver.ts";
export interface NavigationLocation {
  uri: string;
  line: number;
  character: number;
}
export interface SourceRequest {
  kind: IntelliSenseAction;
  uri: string;
  position: Position;
  source: SourceAnchor;
  signal: AbortSignal;
}
export interface ControllerDependencies {
  workspaceRoot: string;
  ui: NativeUI;
  lsp: { query: (request: SourceRequest) => Promise<unknown> };
  neovim: {
    open: (
      location: NavigationLocation,
      options: { signal: AbortSignal; isCurrent: () => Promise<boolean> },
    ) => Promise<unknown>;
  };
  resolveSymbol: (snapshot: Snapshot) => Promise<SourceResolution | null>;
  findWorkspaceSymbols?: (
    source: WorkspaceSymbolQuery,
    options: { signal: AbortSignal },
  ) => Promise<(SourceAnchor & NavigationLocation)[]>;
  getSession: () => { sessionId: string; transcriptRevision: string };
  geometry?: OverlayGeometry;
  validateTarget?: (
    location: NavigationLocation,
  ) => Promise<NavigationLocation | null>;
  validateSource?: (source: SourceAnchor) => Promise<boolean>;
  requestEditorFocus?: (snapshot: Snapshot) => void;
}
function locationLabel(
  location: NavigationLocation,
  workspaceRoot: string,
  width: number,
): string {
  let name = location.uri;
  try {
    name = path.relative(workspaceRoot, fileURLToPath(location.uri));
  } catch {
    // Invalid and non-file URIs remain display-only fallbacks.
  }
  name = stripAnsi(name).replace(/[\x00-\x1f\x7f-\x9f]/gu, "");
  const position = `:${location.line + 1}:${location.character + 1}`;
  const available = Math.max(0, width - visibleWidth(position));
  const parts = name.split(path.sep);
  while (parts.length > 1 && visibleWidth(name) > available) {
    parts.shift();
    name = "…/" + parts.join(path.sep);
  }
  if (parts.length === 1 && visibleWidth(name) > available) name = parts[0];
  return truncateToWidth(name, available) + position;
}

export function createNativeTranscriptController({
  workspaceRoot,
  ui,
  lsp,
  neovim,
  resolveSymbol,
  findWorkspaceSymbols,
  getSession,
  geometry,
  validateTarget,
  validateSource,
  requestEditorFocus,
}: ControllerDependencies) {
  let active = true;
  let revision = 0;
  let abort: AbortController | null = null;
  const current = (s: Snapshot) => {
    const now = getSession();
    return (
      active &&
      now.sessionId === s.sessionId &&
      now.transcriptRevision === s.transcriptRevision &&
      (typeof s.isCurrent !== "function" || s.isCurrent())
    );
  };
  async function chooseLocation<T extends NavigationLocation>(
    action: string,
    locations: T[],
    snapshot: Snapshot,
    signal: AbortSignal,
  ): Promise<T | null | undefined> {
    if (locations.length === 1) return locations[0];
    const options = placeHoverOverlay({
      anchor: snapshot.screenCursor!,
      tooltip: { width: 64, height: Math.min(14, locations.length + 1) },
      terminal: geometry?.terminal ?? {
        rows: process.stdout.rows || 42,
        cols: process.stdout.columns || 120,
      },
      protectedRows: geometry?.protectedRows ?? { top: 1, bottom: 5 },
    });
    let dismissPicker: (() => void) | undefined;
    const cancelPicker = () => dismissPicker?.();
    signal.addEventListener("abort", cancelPicker, { once: true });
    const showPicker = () =>
      ui.custom<T | null>(
        (tui, theme, _keys, done) => {
          dismissPicker = () => done(null);
          if (signal.aborted) dismissPicker();
          let focus = 0;
          return {
            render(width: number) {
              const visibleRows = Math.max(1, options.maxHeight - 1);
              const start = Math.max(0, focus - visibleRows + 1);
              const heading =
                options.maxHeight > 1
                  ? [
                      truncateToWidth(
                        theme.fg("accent", "Choose " + action + " location"),
                        width,
                      ),
                    ]
                  : [];
              return [
                ...heading,
                ...locations.slice(start, start + visibleRows).map((x, i) => {
                  const selected = i + start === focus;
                  return truncateToWidth(
                    theme.fg(
                      selected ? "accent" : "text",
                      (selected ? "> " : "  ") +
                        locationLabel(x, workspaceRoot, width - 2),
                    ),
                    width,
                  );
                }),
              ];
            },
            handleInput(key: string) {
              if (matchesKey(key, Key.escape)) done(null);
              else if (matchesKey(key, Key.tab)) {
                done(null);
                requestEditorFocus?.(snapshot);
              } else if (key === "j" || key === "\x1b[B") {
                focus = Math.min(locations.length - 1, focus + 1);
                tui.requestRender?.();
              } else if (key === "k" || key === "\x1b[A") {
                focus = Math.max(0, focus - 1);
                tui.requestRender?.();
              } else if (matchesKey(key, Key.enter)) done(locations[focus]);
            },
            invalidate() {},
          };
        },
        { overlay: true, overlayOptions: options },
      );
    try {
      return await (snapshot.withNavigationPicker
        ? snapshot.withNavigationPicker(showPicker)
        : showPicker());
    } finally {
      signal.removeEventListener("abort", cancelPicker);
    }
  }
  async function invoke(action: IntelliSenseAction, snapshot: Snapshot) {
    if (!current(snapshot)) return;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal,
      id = ++revision;
    const still = () => current(snapshot) && id === revision && !signal.aborted;
    const intentCurrent = () =>
      active &&
      id === revision &&
      !signal.aborted &&
      getSession().sessionId === snapshot.sessionId &&
      (typeof snapshot.isNavigationCurrent === "function"
        ? snapshot.isNavigationCurrent()
        : current(snapshot));
    let navigationStarted = false;
    let anchor: SourceResolution | null;
    try {
      anchor = await resolveSymbol(snapshot);
    } catch (e) {
      if (still()) ui.notify?.(String(e));
      return;
    }
    if (!still()) return;
    if (!anchor) {
      ui.notify?.("Source mapping unavailable for symbol");
      return;
    }
    if (anchor.kind === "unmapped") {
      const reasons: Record<UnmappedReason, string> = {
        "cursor-not-symbol": "No code symbol at the transcript cursor",
        ambiguous:
          "Multiple source locations match; include more surrounding code",
        "source-unknown":
          "No source identity for this transcript item; update pi-tab-focus if needed",
        "source-unavailable": "Source is missing or outside the workspace",
        "invalid-annotation":
          'Invalid source annotation; use source="path" lines="start-end"',
        "stale-source": "The quoted range no longer matches the source file",
        "wrapped-unmappable":
          "Cannot map this wrapped, truncated, oversized or non-code transcript region",
      };
      ui.notify?.(
        reasons[anchor.reason] ?? "Unable to resolve transcript source",
      );
      return;
    }
    try {
      if (anchor.kind === "workspace-symbol-query" && findWorkspaceSymbols) {
        const symbols = await findWorkspaceSymbols(anchor, { signal });
        if (!still()) return;
        if (!symbols.length) {
          ui.notify?.("No workspace symbol found for " + anchor.token);
          return;
        }
        const selected = await chooseLocation(
          "symbol",
          symbols,
          snapshot,
          signal,
        );
        if (!selected || !still()) return;
        anchor = selected;
      }
      if (anchor.kind === "workspace-symbol-query") return;
      const response = await lsp.query({
        kind: action,
        uri: anchor.uri,
        position: anchor.position,
        source: anchor,
        signal,
      });
      if (!still()) return;
      if (validateSource && !(await validateSource(anchor))) {
        if (still()) ui.notify?.("Source changed during LSP request; retry");
        return;
      }
      if (!still()) return;
      if (action === "hover") {
        const markup =
          normalizeHover(response)?.markdown || "No hover information";
        await showInlineHover({
          ui,
          snapshot,
          signal,
          markup,
          onReturnToEditor: () => requestEditorFocus?.(snapshot),
          geometry: geometry ?? {
            terminal: {
              rows: process.stdout.rows || 42,
              cols: process.stdout.columns || 120,
            },
            protectedRows: { top: 1, bottom: 5 },
          },
        });
        return;
      }
      const locations = normalizeLocations(response);
      if (!locations.length) {
        ui.notify?.("No " + action + " location");
        return;
      }
      const source = anchor;
      const open = async (loc: NavigationLocation) => {
        if (!still()) return;
        if (validateSource && !(await validateSource(source))) {
          if (still())
            ui.notify?.("Source changed during LSP navigation; retry");
          return;
        }
        const target = validateTarget ? await validateTarget(loc) : loc;
        const isCurrent = async () =>
          intentCurrent() &&
          (!validateSource || (await validateSource(source))) &&
          intentCurrent();
        if (target && still()) {
          navigationStarted = true;
          await neovim.open(target, { signal, isCurrent });
        }
      };
      const selected = await chooseLocation(
        action,
        locations,
        snapshot,
        signal,
      );
      if (selected && still()) await open(selected);
    } catch (e) {
      if (navigationStarted ? intentCurrent() : still())
        ui.notify?.(String(e instanceof Error ? e.message : e));
    }
  }
  return {
    invoke,
    dispose() {
      active = false;
      revision++;
      abort?.abort();
    },
  };
}
