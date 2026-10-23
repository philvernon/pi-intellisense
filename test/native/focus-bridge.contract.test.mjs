import test from "node:test";
import assert from "node:assert/strict";

/**
 * NT-01, NT-05, NT-10 — contract for the patch to pi-tab-focus.
 * This is a RED native-feature acceptance suite, not a test of /intel.
 * The adapter API will be implemented in/ported to pi-tab-focus.
 */
async function adapter() {
  return import("../../src/native/tab-focus-adapter.ts");
}
function bus() {
  const listeners = new Map(), records = [];
  return {
    records,
    on(name, fn) {
      const set = listeners.get(name) ?? new Set();
      set.add(fn); listeners.set(name, set);
      return () => set.delete(fn);
    },
    emit(name, value) {
      records.push({ name, value });
      for (const fn of listeners.get(name) ?? []) fn(value);
    }
  };
}
const baseFocus = () => ({
  sessionId: "session-1",
  mode: "visual",
  focused: true,
  transientFocused: false,
  exDetour: false,
  itemSemanticKey: "assistant:code:1",
  itemKind: "message",
  transcriptRevision: "rev-7",
  layoutRevision: "layout-12",
  visualCursor: { row: 53, col: 18 },
  screenCursor: { row: 16, col: 18 },
  selectedCodeRegionId: "code:0",
  sourceSpans: [{ displayRow: 53, colStart: 15, colEnd: 24, codeRegionId: "code:0" }]
});
function fixture() {
  const events = bus(), invoked = [], legacy = [], state = baseFocus();
  const deps = {
    events,
    getFocus: () => state,
    legacyHandleKey: key => { legacy.push(key); return { handled: true, owner: "tab-focus" }; }
  };
  return { deps, events, invoked, legacy, state };
}
function connect(f) {
  f.events.emit("pi-intellisense:register:v1", {
    sessionId: "session-1",
    extensionId: "pi-intellisense",
    actions: ["hover", "definition", "references"],
    invoke: async (action, snapshot) => { f.invoked.push({ action, snapshot }); }
  });
}

test("NT-01: K on visual cursor delegates to inline LSP without opening a second viewer", async () => {
  const { createTabFocusNativeBridge } = await adapter();
  const f = fixture();
  const bridge = createTabFocusNativeBridge(f.deps);
  connect(f);
  await bridge.handleKey("K");
  assert.equal(f.invoked.length, 1);
  assert.equal(f.invoked[0].action, "hover");
  assert.deepEqual(f.invoked[0].snapshot.visualCursor, f.state.visualCursor);
  assert.equal(f.invoked[0].snapshot.itemSemanticKey, "assistant:code:1");
  assert.deepEqual(f.legacy, []);
  bridge.dispose();
});

test("NT-05: item-mode K, existing gg/ge and y are still owned by pi-tab-focus", async () => {
  const { createTabFocusNativeBridge } = await adapter();
  const f = fixture(), bridge = createTabFocusNativeBridge(f.deps);
  connect(f);
  f.state.mode = "item";
  await bridge.handleKey("K");
  f.state.mode = "visual";
  for (const key of ["g", "g", "g", "e", "y"]) await bridge.handleKey(key);
  assert.equal(f.invoked.length, 0, "legacy motions cannot dispatch LSP");
  assert.ok(f.legacy.includes("K"), "item mode K must retain previous-item behaviour");
  assert.ok(f.legacy.includes("y"), "native yank must be preserved");
  bridge.dispose();
});

test("NT-05: gd is a two-key prefix and does not break independent g commands", async () => {
  const { createTabFocusNativeBridge } = await adapter();
  const f = fixture(), bridge = createTabFocusNativeBridge(f.deps);
  connect(f);
  await bridge.handleKey("g");
  assert.equal(f.invoked.length, 0);
  await bridge.handleKey("d");
  assert.deepEqual(f.invoked.map(x => x.action), ["definition"]);
  const snapshot = f.invoked[0].snapshot;
  assert.equal(snapshot.sessionId, "session-1");
  assert.equal(snapshot.transcriptRevision, "rev-7");
  assert.equal(snapshot.layoutRevision, "layout-12");
  bridge.dispose();
});

test("NT-10: transient Pi overlay, EX detour and editor input never lose key ownership", async () => {
  const { createTabFocusNativeBridge } = await adapter();
  const f = fixture(), bridge = createTabFocusNativeBridge(f.deps);
  connect(f);
  for (const change of [
    { transientFocused: true },
    { exDetour: true },
    { mode: "editor" },
    { focused: false }
  ]) {
    Object.assign(f.state, baseFocus(), change);
    await bridge.handleKey("K");
  }
  assert.equal(f.invoked.length, 0);
  assert.equal(f.legacy.length, 4);
  bridge.dispose();
});

test("NT-10: extension load order, session change and dispose never create duplicate bindings", async () => {
  const { createTabFocusNativeBridge } = await adapter();
  const f = fixture(), bridge = createTabFocusNativeBridge(f.deps);
  connect(f);
  connect(f); // idempotent registration must replace, not stack
  await bridge.handleKey("K");
  assert.equal(f.invoked.length, 1);
  f.state.sessionId = "session-2";
  await bridge.handleKey("K");
  assert.equal(f.invoked.length, 1, "stale session registration rejected");
  bridge.dispose();
  f.state.sessionId = "session-1";
  await bridge.handleKey("K");
  assert.equal(f.invoked.length, 1, "unloaded bridge cannot invoke LSP");
});
