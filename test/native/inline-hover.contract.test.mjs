import test from "node:test";
import assert from "node:assert/strict";

/** NT-02, NT-03, NT-07: actual terminal coordinates and Pi overlay API. */
const projection = () => import("../../src/native/overlay-geometry.ts");
const popup = () => import("../../src/native/inline-hover.ts");

const viewport = {
  scrollTop: 40, top: 3, left: 2, height: 20, width: 90
};
const terminal = { rows: 42, cols: 120 };

test("NT-02: transcript absolute row/column project into terminal viewport coordinates", async () => {
  const { projectTranscriptCursor } = await projection();
  assert.deepEqual(projectTranscriptCursor({
    cursor: { row: 53, col: 18 }, viewport, terminal
  }), { row: 16, col: 20 });
  assert.equal(projectTranscriptCursor({
    cursor: { row: 60, col: 18 }, viewport, terminal
  }), null, "offscreen transcript symbol is not hoverable");
  assert.equal(projectTranscriptCursor({
    cursor: { row: 53, col: 95 }, viewport, terminal
  }), null, "offscreen columns cannot get phantom popups");
});

test("NT-02: popup is adjacent to symbol, within edges and outside fixed prompt/status rows", async () => {
  const { placeHoverOverlay } = await projection();
  const options = placeHoverOverlay({
    anchor: { row: 16, col: 20 }, terminal,
    tooltip: { width: 54, height: 14 }, protectedRows: { top: 2, bottom: 4 }
  });
  assert.ok(options.row >= 2 && options.row < 38);
  assert.ok(options.col > 20, "prefer tooltip next to symbol, not in a separate panel");
  assert.ok(options.col + options.width <= 120);
  assert.ok(options.row + options.maxHeight <= 38);
  assert.notEqual(options.anchor, "center");
});

test("NT-02: popup flips to visible side if symbol is near the right/bottom edges", async () => {
  const { placeHoverOverlay } = await projection();
  const options = placeHoverOverlay({
    anchor: { row: 35, col: 115 }, terminal,
    tooltip: { width: 50, height: 12 }, protectedRows: { top: 2, bottom: 4 }
  });
  assert.ok(options.col < 115);
  assert.ok(options.row < 35);
  assert.ok(options.col >= 0);
  assert.ok(options.row + options.maxHeight <= 38);
});

test("NT-02: K uses Pi overlay:true and NEVER replaces the transcript or opens /intel", async () => {
  const { showInlineHover } = await popup();
  const call = { options: null, component: null };
  const ui = {
    custom(factory, options) {
      call.options = options;
      call.component = factory({ requestRender() {} }, { fg: (_c, text) => text }, {}, () => {});
      return Promise.resolve();
    },
    setEditorComponent() { throw new Error("cannot replace the Pi editor"); },
    sendUserMessage() { throw new Error("hover must not trigger the model"); }
  };
  await showInlineHover({
    ui, snapshot: { sessionId: "s", itemSemanticKey: "message:4",
      visualCursor: { row: 53, col: 18 }, screenCursor: { row: 16, col: 20 } },
    markup: "(alias) function calculateTotal(): number",
    geometry: { terminal, protectedRows: { top: 2, bottom: 4 } }
  });
  assert.equal(call.options?.overlay, true);
  assert.equal(typeof call.options?.overlayOptions?.row, "number");
  assert.equal(typeof call.options?.overlayOptions?.col, "number");
  assert.ok(call.options.overlayOptions.width > 0);
  assert.ok(call.component.render(70).join("\n").includes("calculateTotal"));
});

test("NT-03: Esc dismisses only tooltip; same transcript cursor and yank state survive", async () => {
  const { showInlineHover } = await popup();
  const state = { mode: "visual", item: "message:4", row: 53, col: 18,
    scrollTop: 40, yank: "existing yank", selection: { anchor: 10, head: 18 } };
  let component, dismissed = false;
  const before = structuredClone(state);
  const ui = {
    custom(factory, options) {
      assert.equal(options.overlay, true);
      component = factory({ requestRender() {} }, { fg: (_c, text) => text }, {}, () => { dismissed = true; });
      return Promise.resolve();
    }
  };
  await showInlineHover({
    ui, snapshot: { sessionId: "s", itemSemanticKey: "message:4",
      screenCursor: { row: 16, col: 20 }, visualCursor: { row: 53, col: 18 } },
    markup: "Hover docs", geometry: { terminal, protectedRows: { top: 2, bottom: 4 } },
    focusState: state
  });
  component.handleInput("\x1b");
  assert.equal(dismissed, true);
  assert.deepEqual(state, before, "hover/escape must not reset transcript or selection state");
});

test("NT-07: hidden/reflowed anchor cannot leave an orphan positioned tooltip", async () => {
  const { projectTranscriptCursor } = await projection();
  assert.equal(projectTranscriptCursor({
    cursor: { row: 53, col: 18 },
    viewport: { ...viewport, scrollTop: 54 }, terminal
  }), null, "after scroll past the symbol the tooltip anchor is invalid");
  assert.equal(projectTranscriptCursor({
    cursor: { row: 53, col: 18 },
    viewport: { ...viewport, width: 10 }, terminal
  }), null, "terminal rewrap invalidates the old display coordinate");
});
