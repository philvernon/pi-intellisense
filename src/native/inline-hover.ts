import { placeHoverOverlay, type OverlayGeometry } from "./overlay-geometry.ts";
import type { Snapshot } from "../bridge/register.ts";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
export type NativeUI = Pick<ExtensionUIContext, "custom" | "notify">;
import { truncateToWidth, matchesKey, Key } from "@earendil-works/pi-tui";
function sanitize(value: string) {
  return String(value)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/gu, "");
}
export async function showInlineHover({
  ui,
  snapshot,
  markup,
  geometry,
  signal,
  onReturnToEditor,
}: {
  ui: NativeUI;
  snapshot: Snapshot;
  markup: string;
  geometry: OverlayGeometry;
  signal?: AbortSignal;
  onReturnToEditor?: () => void;
}) {
  const anchor = snapshot.screenCursor;
  if (!anchor || signal?.aborted) return;
  const opts = placeHoverOverlay({
    anchor,
    tooltip: {
      width: Math.min(68, Math.max(30, geometry.terminal.cols - 4)),
      height: 14,
    },
    ...geometry,
  });
  const lines = sanitize(markup)
    .split("\n")
    .filter((line) => !/^\s*\x60{3,}(?:\w+)?\s*$/u.test(line));
  let close: (() => void) | undefined;
  const cancel = () => close?.();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await ui.custom<void>(
      (tui, theme, _keys, done) => {
        close = () => done(undefined);
        if (signal?.aborted) close();
        let top = 0;
        return {
          render(width: number) {
            const visible = lines.slice(
              top,
              top + Math.max(1, opts.maxHeight - 2),
            );
            return [
              truncateToWidth(
                theme.fg(
                  "accent",
                  "╭─ LSP hover ─" + "─".repeat(Math.max(0, width - 15)) + "╮",
                ),
                width,
              ),
              ...visible.map((line, i) =>
                truncateToWidth(
                  theme.fg(top + i === 0 ? "accent" : "text", line),
                  width,
                ),
              ),
              truncateToWidth(
                theme.fg("dim", "Esc close · Tab prompt · j/k scroll"),
                width,
              ),
            ];
          },
          handleInput(key: string) {
            if (matchesKey(key, Key.escape) || key === "escape")
              return close?.();
            if (matchesKey(key, Key.tab) || key === "tab") {
              close?.();
              onReturnToEditor?.();
              return;
            }
            if (key === "j" || matchesKey(key, Key.down))
              top = Math.min(Math.max(0, lines.length - 1), top + 1);
            if (key === "k" || matchesKey(key, Key.up))
              top = Math.max(0, top - 1);
            tui.requestRender?.();
          },
          invalidate() {},
        };
      },
      { overlay: true, overlayOptions: opts },
    );
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
