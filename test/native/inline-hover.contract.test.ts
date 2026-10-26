import test from "node:test";
import assert from "node:assert/strict";
import type { NativeUI } from "../../src/native/inline-hover.ts";
import { transcriptSnapshot } from "../helpers.ts";
import {
  customUI,
  mountComponent,
  type CustomOptions,
  type TestComponent,
} from "../ui-helpers.ts";

const projection = () => import("../../src/native/overlay-geometry.ts");
const popup = () => import("../../src/native/inline-hover.ts");

const viewport = {
  scrollTop: 40,
  top: 3,
  left: 2,
  height: 20,
  width: 90,
};
const terminal = { rows: 42, cols: 120 };

test("NT-02: transcript absolute row/column project into terminal viewport coordinates", async () => {
  const { projectTranscriptCursor } = await projection();
  assert.deepEqual(
    projectTranscriptCursor({
      cursor: { row: 53, col: 18 },
      viewport,
      terminal,
    }),
    { row: 16, col: 20 },
  );
  assert.equal(
    projectTranscriptCursor({
      cursor: { row: 60, col: 18 },
      viewport,
      terminal,
    }),
    null,
    "offscreen transcript symbol is not hoverable",
  );
  assert.equal(
    projectTranscriptCursor({
      cursor: { row: 53, col: 95 },
      viewport,
      terminal,
    }),
    null,
    "offscreen columns cannot get phantom popups",
  );
});

test("NT-02: popup is adjacent to symbol, within edges and outside fixed prompt/status rows", async () => {
  const { placeHoverOverlay } = await projection();
  const options = placeHoverOverlay({
    anchor: { row: 16, col: 20 },
    terminal,
    tooltip: { width: 54, height: 14 },
    protectedRows: { top: 2, bottom: 4 },
  });
  assert.ok(options.row >= 2 && options.row < 38);
  assert.ok(
    options.col > 20,
    "prefer tooltip next to symbol, not in a separate panel",
  );
  assert.ok(options.col + options.width <= 120);
  assert.ok(options.row + options.maxHeight <= 38);
  assert.notEqual(options.anchor, "center");
});

test("NT-02: popup flips to visible side if symbol is near the right/bottom edges", async () => {
  const { placeHoverOverlay } = await projection();
  const options = placeHoverOverlay({
    anchor: { row: 35, col: 115 },
    terminal,
    tooltip: { width: 50, height: 12 },
    protectedRows: { top: 2, bottom: 4 },
  });
  assert.ok(options.col < 115);
  assert.ok(options.row < 35);
  assert.ok(options.col >= 0);
  assert.ok(options.row + options.maxHeight <= 38);
});

test("NT-02: K uses Pi overlay:true and NEVER replaces the transcript or opens /intel", async () => {
  const { showInlineHover } = await popup();
  const call: { options?: CustomOptions; component?: TestComponent } = {};
  const ui = {
    notify() {},
    custom: customUI((factory, options) => {
      call.options = options;
      call.component = mountComponent(factory);
      return Promise.resolve();
    }),
    setEditorComponent() {
      throw new Error("cannot replace the Pi editor");
    },
    sendUserMessage() {
      throw new Error("hover must not trigger the model");
    },
  };
  await showInlineHover({
    ui,
    snapshot: transcriptSnapshot({
      sessionId: "s",
      itemSemanticKey: "message:4",
      visualCursor: { row: 53, col: 18 },
      screenCursor: { row: 16, col: 20 },
    }),
    markup: "(alias) function calculateTotal(): number",
    geometry: { terminal, protectedRows: { top: 2, bottom: 4 } },
  });
  assert.equal(call.options?.overlay, true);
  const overlay = call.options?.overlayOptions;
  assert.ok(overlay && typeof overlay !== "function");
  assert.equal(typeof overlay.row, "number");
  assert.equal(typeof overlay.col, "number");
  assert.ok(Number(overlay.width) > 0);
  assert.ok(call.component!.render(70).join("\n").includes("calculateTotal"));
});

test("NT-03: Esc dismisses only tooltip; same transcript cursor and yank state survive", async () => {
  const { showInlineHover } = await popup();
  const state = {
    mode: "visual",
    item: "message:4",
    row: 53,
    col: 18,
    scrollTop: 40,
    yank: "existing yank",
    selection: { anchor: 10, head: 18 },
  };
  let component!: TestComponent;
  let dismissed = false;
  const before = structuredClone(state);
  const ui: NativeUI = {
    notify() {},
    custom: customUI((factory, options) => {
      assert.equal(options?.overlay, true);
      component = mountComponent(factory, () => {
        dismissed = true;
      });
      return Promise.resolve();
    }),
  };
  await showInlineHover({
    ui,
    snapshot: transcriptSnapshot({
      sessionId: "s",
      itemSemanticKey: "message:4",
      screenCursor: { row: 16, col: 20 },
      visualCursor: { row: 53, col: 18 },
    }),
    markup: "Hover docs",
    geometry: { terminal, protectedRows: { top: 2, bottom: 4 } },
  });
  component.handleInput("\x1b");
  assert.equal(dismissed, true);
  assert.deepEqual(
    state,
    before,
    "hover/escape must not reset transcript or selection state",
  );
});

test("NT-07: hidden/reflowed anchor cannot leave an orphan positioned tooltip", async () => {
  const { projectTranscriptCursor } = await projection();
  assert.equal(
    projectTranscriptCursor({
      cursor: { row: 53, col: 18 },
      viewport: { ...viewport, scrollTop: 54 },
      terminal,
    }),
    null,
    "after scroll past the symbol the tooltip anchor is invalid",
  );
  assert.equal(
    projectTranscriptCursor({
      cursor: { row: 53, col: 18 },
      viewport: { ...viewport, width: 10 },
      terminal,
    }),
    null,
    "terminal rewrap invalidates the old display coordinate",
  );
});
test("Focus-P0: Tab on a capturing hover closes it and returns to the Pi editor", async () => {
  const { showInlineHover } = await popup();
  let component!: TestComponent;
  let done = 0,
    returned = 0;
  const ui: NativeUI = {
    notify() {},
    custom: customUI((factory, options) => {
      assert.equal(options?.overlay, true);
      component = mountComponent(factory, () => {
        done++;
      });
      return Promise.resolve();
    }),
  };
  await showInlineHover({
    ui,
    snapshot: transcriptSnapshot({ screenCursor: { row: 9, col: 10 } }),
    markup: "Hover",
    geometry: {
      terminal: { rows: 35, cols: 100 },
      protectedRows: { top: 1, bottom: 5 },
    },
    onReturnToEditor: () => {
      assert.equal(
        done,
        1,
        "close capturing overlay before returning to editor",
      );
      returned++;
    },
  });
  component.handleInput("\t");
  assert.equal(done, 1);
  assert.equal(returned, 1);
});

test("Focus-P0: Esc dismisses the hover but must not change editor/transcript focus", async () => {
  const { showInlineHover } = await popup();
  let component!: TestComponent;
  let returned = 0,
    done = 0;
  const ui: NativeUI = {
    notify() {},
    custom: customUI((factory) => {
      component = mountComponent(factory, () => done++);
      return Promise.resolve();
    }),
  };
  await showInlineHover({
    ui,
    snapshot: transcriptSnapshot({ screenCursor: { row: 9, col: 10 } }),
    markup: "Hover",
    geometry: {
      terminal: { rows: 35, cols: 100 },
      protectedRows: { top: 1, bottom: 5 },
    },
    onReturnToEditor: () => returned++,
  });
  component.handleInput("\x1b");
  assert.equal(done, 1);
  assert.equal(returned, 0);
});
