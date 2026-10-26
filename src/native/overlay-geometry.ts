import type { Cursor } from "../bridge/register.ts";
export interface TerminalSize {
  rows: number;
  cols: number;
}
export interface OverlayGeometry {
  terminal: TerminalSize;
  protectedRows?: { top: number; bottom: number };
}
export function projectTranscriptCursor({
  cursor,
  viewport,
  terminal,
}: {
  cursor: Cursor;
  viewport: {
    scrollTop: number;
    top: number;
    left: number;
    height: number;
    width: number;
  };
  terminal: TerminalSize;
}) {
  const { scrollTop, top, left, height, width } = viewport;
  const row = top + cursor.row - scrollTop,
    col = left + cursor.col;
  if (
    cursor.row < scrollTop ||
    cursor.row >= scrollTop + height ||
    cursor.col < 0 ||
    cursor.col >= width ||
    row < 0 ||
    row >= terminal.rows ||
    col < 0 ||
    col >= terminal.cols
  )
    return null;
  return { row, col };
}
export function placeHoverOverlay({
  anchor,
  tooltip,
  terminal,
  protectedRows = { top: 0, bottom: 0 },
}: OverlayGeometry & {
  anchor: Cursor;
  tooltip: { width: number; height: number };
}) {
  const top = Math.max(0, protectedRows.top || 0),
    bottom = Math.max(top + 1, terminal.rows - (protectedRows.bottom || 0));
  const width = Math.max(1, Math.min(tooltip.width, terminal.cols));
  const maxHeight = Math.max(1, Math.min(tooltip.height, bottom - top));
  let col = anchor.col + 2;
  if (col + width > terminal.cols) col = Math.max(0, anchor.col - width - 1);
  let row = anchor.row;
  if (row + maxHeight > bottom) row = Math.max(top, anchor.row - maxHeight);
  row = Math.max(top, Math.min(row, bottom - maxHeight));
  return { row, col, width, maxHeight, anchor: "top-left" as const };
}
