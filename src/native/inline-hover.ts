import {
  getMarkdownTheme,
  type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Markdown,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Snapshot } from "../bridge/register.ts";
import { stripAnsi } from "../positions.ts";
import { placeHoverOverlay, type OverlayGeometry } from "./overlay-geometry.ts";

export type NativeUI = Pick<ExtensionUIContext, "custom" | "notify">;

function sanitize(value: string): string {
  return value
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
}): Promise<void> {
  const anchor = snapshot.screenCursor;
  if (!anchor || signal?.aborted) return;
  let getOptions: () => ReturnType<typeof placeHoverOverlay>;
  let close: (() => void) | undefined;
  const cancel = () => close?.();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    return await ui.custom<void>(
      (tui, theme, _keys, done) => {
        close = () => done(undefined);
        if (signal?.aborted) close();
        const markdown = new Markdown(
          sanitize(markup).trim(),
          0,
          0,
          {
            ...getMarkdownTheme(),
            codeBlockBorder: () => "",
            codeBlockIndent: "",
          },
          { color: (text) => theme.fg("text", text) },
        );
        let top = 0;
        let columns = 0;
        let rows = 0;
        let options: ReturnType<typeof placeHoverOverlay> | undefined;
        let lines: string[] = [];

        function renderContent(width: number): string[] {
          const rendered = markdown.render(Math.max(1, width - 2));
          let start = 0;
          let end = rendered.length;
          while (start < end && !stripAnsi(rendered[start]!).trim()) start++;
          while (end > start && !stripAnsi(rendered[end - 1]!).trim()) end--;
          return rendered.slice(start, end);
        }

        getOptions = () => {
          const terminal = {
            cols: tui.terminal.columns,
            rows: tui.terminal.rows,
          };
          if (options && columns === terminal.cols && rows === terminal.rows)
            return options;
          columns = terminal.cols;
          rows = terminal.rows;
          const maxWidth = Math.max(1, terminal.cols - 4);
          let measured = renderContent(maxWidth);
          if (!measured.length) {
            markdown.setText("No hover information");
            measured = renderContent(maxWidth);
          }
          const width = Math.min(
            maxWidth,
            measured.reduce(
              (width, line) =>
                Math.max(width, visibleWidth(stripAnsi(line).trimEnd()) + 2),
              3,
            ),
          );
          lines = renderContent(width);
          options = placeHoverOverlay({
            ...geometry,
            anchor,
            terminal,
            tooltip: { width, height: Math.max(1, lines.length) },
          });
          top = Math.min(top, Math.max(0, lines.length - options.maxHeight));
          return options;
        };

        return {
          render(width: number) {
            const { maxHeight } = getOptions();
            const padding = width > 2 ? " " : "";
            const background = theme.getBgAnsi("userMessageBg");
            return lines.slice(top, top + maxHeight).map((line) => {
              const padded = truncateToWidth(
                padding + line + padding,
                width,
                "",
                true,
              );
              // Syntax highlighting and wrapping can reset the panel background.
              return theme.bg(
                "userMessageBg",
                padded.replace(/\x1b\[(?:0|49)?m/gu, `$&${background}`),
              );
            });
          },
          handleInput(key: string) {
            if (matchesKey(key, Key.escape) || key === "escape")
              return close?.();
            if (matchesKey(key, Key.tab) || key === "tab") {
              close?.();
              onReturnToEditor?.();
              return;
            }
            const { maxHeight } = getOptions();
            if (key === "j" || matchesKey(key, Key.down))
              top = Math.min(Math.max(0, lines.length - maxHeight), top + 1);
            if (key === "k" || matchesKey(key, Key.up))
              top = Math.max(0, top - 1);
            tui.requestRender();
          },
          invalidate() {
            markdown.invalidate();
            options = undefined;
          },
        };
      },
      { overlay: true, overlayOptions: () => getOptions() },
    );
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}
