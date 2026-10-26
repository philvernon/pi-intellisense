import test from "node:test";
import assert from "node:assert/strict";
import type {
  ControllerDependencies,
  SourceRequest,
  NavigationLocation,
} from "../../src/native/native-controller.ts";
import type { SourceAnchor } from "../../src/native/transcript-source.ts";
import { transcriptSnapshot } from "../helpers.ts";
import {
  customUI,
  mountComponent,
  type CustomOptions,
  type TestComponent,
} from "../ui-helpers.ts";

async function native() {
  return import("../../src/native/native-controller.ts");
}
function fixture(overrides: Partial<ControllerDependencies> = {}) {
  const seen: {
    lsp: SourceRequest[];
    overlay: CustomOptions[];
    opened: NavigationLocation[];
    notifications: string[];
    model: string[];
    replaced: number;
  } = {
    lsp: [],
    overlay: [],
    opened: [],
    notifications: [],
    model: [],
    replaced: 0,
  };
  const snapshot = transcriptSnapshot({
    version: 1,
    sessionId: "s1",
    itemSemanticKey: "assistant:2",
    transcriptRevision: "rev:5",
    layoutRevision: "layout:8",
    visualCursor: { row: 51, col: 17 },
    screenCursor: { row: 13, col: 17 },
  });
  const anchor: SourceAnchor = {
    kind: "verified-file",
    origin: "structured-read",
    uri: "file:///project/src/total.ts",
    position: { line: 19, character: 12 },
    fileHash: "v8",
    token: "calculateTotal",
  };
  let sessionId = "s1",
    version = "rev:5";
  const ui: ControllerDependencies["ui"] & {
    setEditorComponent(): never;
    sendUserMessage(message: string): void;
  } = {
    custom: customUI(async (_factory, options) => {
      seen.overlay.push(options);
      return null;
    }),
    notify(message: string) {
      seen.notifications.push(message);
    },
    setEditorComponent() {
      seen.replaced++;
      throw new Error("transcript replacement forbidden");
    },
    sendUserMessage(message: string) {
      seen.model.push(message);
    },
  };
  const lsp: ControllerDependencies["lsp"] = {
    async query(request) {
      seen.lsp.push(request);
      if (request.kind === "hover")
        return {
          contents: { kind: "markdown", value: "calculateTotal(): number" },
        };
      return {
        uri: "file:///project/src/math.ts",
        range: {
          start: { line: 10, character: 4 },
          end: { line: 10, character: 18 },
        },
      };
    },
  };
  const neovim: ControllerDependencies["neovim"] = {
    async open(target) {
      seen.opened.push(target);
    },
  };
  const dependencies: ControllerDependencies = {
    ui,
    lsp,
    neovim,
    resolveSymbol: async () => anchor,
    getSession: () => ({ sessionId, transcriptRevision: version }),
    ...overrides,
  };
  return {
    ...dependencies,
    seen,
    snapshot,
    anchor,
    switchSession(id: string) {
      sessionId = id;
    },
    updateRevision(v: string) {
      version = v;
    },
  };
}

test("NT-01/02: K queries exact LSP symbol and creates ONLY an inline Pi overlay", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  const controller = createNativeTranscriptController(f);
  await controller.invoke("hover", f.snapshot);
  assert.equal(f.seen.lsp.length, 1);
  assert.deepEqual(f.seen.lsp[0].position, { line: 19, character: 12 });
  assert.equal(f.seen.lsp[0].kind, "hover");
  assert.equal(f.seen.overlay.length, 1);
  assert.equal(f.seen.overlay[0]?.overlay, true);
  assert.equal(
    f.seen.replaced,
    0,
    "native Pi transcript cannot be replaced by /intel viewer",
  );
  assert.deepEqual(f.seen.model, []);
  controller.dispose();
});

test("NT-04: gd opens real LSP definition, not the source snippet or a new code viewer", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.deepEqual(
    f.seen.lsp.map((x) => x.kind),
    ["definition"],
  );
  assert.equal(f.seen.opened.length, 1);
  assert.deepEqual(f.seen.opened[0], {
    uri: "file:///project/src/math.ts",
    line: 10,
    character: 4,
  });
  assert.equal(f.seen.replaced, 0);
  assert.equal(f.seen.model.length, 0);
  controller.dispose();
});

test("NT-04: multiple definition targets open a transient inline picker, not first result", async () => {
  const { createNativeTranscriptController } = await native();
  const locations = [
    {
      uri: "file:///project/src/one.ts",
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 3 },
      },
    },
    {
      uri: "file:///project/src/two.ts",
      range: {
        start: { line: 3, character: 4 },
        end: { line: 3, character: 5 },
      },
    },
  ];
  const f = fixture({
    lsp: {
      async query() {
        return locations;
      },
    },
  });
  let pickerCalls = 0;
  f.snapshot.withNavigationPicker = async (run) => {
    pickerCalls++;
    return await run();
  };
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.equal(pickerCalls, 1);
  assert.equal(
    f.seen.opened.length,
    0,
    "must require choosing among multiple targets",
  );
  assert.equal(f.seen.overlay.length, 1);
  assert.equal(f.seen.overlay[0]?.overlay, true);
  controller.dispose();
});

test("NT-07: stale query result from different session/revision cannot overlay or navigate", async () => {
  const { createNativeTranscriptController } = await native();
  let release!: (value: unknown) => void;
  const f = fixture({
    lsp: {
      query: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const controller = createNativeTranscriptController(f);
  const pending = controller.invoke("hover", f.snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  f.switchSession("s2");
  f.updateRevision("rev:6");
  release({ contents: "STALE DOCS" });
  await pending;
  assert.equal(f.seen.overlay.length, 0);
  assert.equal(f.seen.opened.length, 0);
  controller.dispose();
});

test("NT-06: unmapped symbol produces a local status without LSP, model or alternate viewer", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture({ resolveSymbol: async () => null });
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.equal(f.seen.lsp.length, 0);
  assert.equal(f.seen.opened.length, 0);
  assert.equal(f.seen.replaced, 0);
  assert.equal(f.seen.model.length, 0);
  assert.match(
    f.seen.notifications.join(" "),
    /source|mapping|definition|symbol/i,
  );
  controller.dispose();
});
test("Focus-P0: when user tabs to editor while LSP is pending, delayed hover never opens", async () => {
  const { createNativeTranscriptController } = await native();
  let release!: (value: unknown) => void;
  let focused = true;
  const f = fixture({
    lsp: {
      query: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const controller = createNativeTranscriptController(f);
  const pending = controller.invoke("hover", {
    ...f.snapshot,
    isCurrent: () => focused,
  });
  await new Promise((resolve) => setImmediate(resolve));
  focused = false;
  release({ contents: "outdated hover" });
  await pending;
  assert.equal(f.seen.overlay.length, 0);
  controller.dispose();
});
test("Navigation-P0: source modification after definition result cannot trigger wrong-file Neovim jump", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  const controller = createNativeTranscriptController({
    ...f,
    validateSource: async () => false,
  });
  await controller.invoke("definition", f.snapshot);
  assert.deepEqual(f.seen.opened, []);
  assert.match(f.seen.notifications.join(" "), /Source changed/i);
  controller.dispose();
});

test("source changes during hover suppress stale tooltip as well as navigation", async () => {
  const f = fixture(),
    { createNativeTranscriptController } = await native();
  const controller = createNativeTranscriptController({
    ...f,
    validateSource: async () => false,
  });
  await controller.invoke("hover", f.snapshot);
  assert.equal(f.seen.overlay.length, 0);
  assert.match(f.seen.notifications.join(" "), /Source changed/);
  controller.dispose();
});

test("disposing the production controller dismisses an already-open hover", async () => {
  const f = fixture(),
    { createNativeTranscriptController } = await native();
  let component: TestComponent | undefined,
    closed = false;
  f.ui.custom = customUI(
    (factory) =>
      new Promise((resolve) => {
        component = mountComponent(factory, (value) => {
          closed = true;
          resolve(value);
        });
      }),
  );
  const controller = createNativeTranscriptController(f);
  const pending = controller.invoke("hover", f.snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(component);
  controller.dispose();
  await pending;
  assert.equal(closed, true);
});

test("multi-result picker scrolls beyond twelve locations and displays no terminal controls from LSP URIs", async () => {
  const f = fixture(),
    { createNativeTranscriptController } = await native();
  const locations = Array.from({ length: 15 }, (_, i) => ({
    uri: `file:///project/target${i}.ts`,
    range: { start: { line: i, character: 0 }, end: { line: i, character: 1 } },
  }));
  locations[0].uri = "file:///project/\x1b]52;c;unsafe\x07target0.ts";
  f.lsp.query = async () => locations;
  let screen = "";
  f.ui.custom = customUI(
    (factory) =>
      new Promise((resolve) => {
        const component = mountComponent(factory, resolve);
        assert.ok(!component.render(80).join("\n").includes("\x1b]"));
        for (let i = 0; i < 13; i++) component.handleInput("j");
        screen = component.render(80).join("\n");
        component.handleInput("\r");
      }),
  );
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.match(screen, /> .*target13\.ts/);
  assert.equal(f.seen.opened[0].uri, "file:///project/target13.ts");
  controller.dispose();
});

test("editor handoff retains cancellation and async source currency through delayed startup", async () => {
  const f = fixture(),
    { createNativeTranscriptController } = await native();
  let sourceCurrent = true;
  let options!: Parameters<ControllerDependencies["neovim"]["open"]>[1];
  f.neovim.open = async (_target, received) => {
    options = received;
  };
  const controller = createNativeTranscriptController({
    ...f,
    validateSource: async () => sourceCurrent,
  });
  await controller.invoke("definition", f.snapshot);
  assert.equal(await options.isCurrent(), true);
  sourceCurrent = false;
  assert.equal(await options.isCurrent(), false);
  controller.dispose();
  assert.equal(options.signal.aborted, true);
});

for (const staleIntent of [false, true]) {
  test(`editor failure after split reflow ${staleIntent ? "suppresses stale intent" : "reports current intent"}`, async () => {
    const f = fixture(),
      { createNativeTranscriptController } = await native();
    let layoutCurrent = true,
      intentCurrent = true;
    f.snapshot.isCurrent = () => layoutCurrent;
    f.snapshot.isNavigationCurrent = () => intentCurrent;
    f.neovim.open = async () => {
      layoutCurrent = false;
      if (staleIntent) intentCurrent = false;
      throw new Error("editor RPC failed");
    };
    const controller = createNativeTranscriptController(f);
    await controller.invoke("definition", f.snapshot);
    assert.deepEqual(
      f.seen.notifications,
      staleIntent ? [] : ["editor RPC failed"],
    );
    controller.dispose();
  });
}

test("committed editor navigation survives its own split reflow but not changed intent", async () => {
  const f = fixture(),
    { createNativeTranscriptController } = await native();
  let layoutCurrent = true,
    intentCurrent = true;
  f.snapshot.isCurrent = () => layoutCurrent;
  f.snapshot.isNavigationCurrent = () => intentCurrent;
  f.neovim.open = async (_target, options) => {
    layoutCurrent = false;
    assert.equal(await options.isCurrent(), true);
    intentCurrent = false;
    assert.equal(await options.isCurrent(), false);
  };
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  controller.dispose();
});

test("workspace lookup supplies real document context for ordinary transcript hover", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  const target = {
    ...f.anchor,
    kind: "verified-file",
    origin: "workspace-symbol",
    line: 19,
    character: 12,
  } satisfies SourceAnchor & NavigationLocation;
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
    languageId: "typescript",
  });
  f.findWorkspaceSymbols = async (source, { signal }) => {
    assert.deepEqual(source, {
      kind: "workspace-symbol-query",
      token: "calculateTotal",
      languageId: "typescript",
    });
    assert.equal(signal.aborted, false);
    return [target];
  };
  const controller = createNativeTranscriptController(f);
  await controller.invoke("hover", f.snapshot);
  assert.equal(f.seen.lsp[0].uri, target.uri);
  assert.deepEqual(f.seen.lsp[0].position, target.position);
  assert.equal(f.seen.lsp[0].source.origin, "workspace-symbol");
  assert.equal(f.seen.overlay.length, 1);
  controller.dispose();
});

test("gd sends textDocument/definition for a workspace-resolved symbol", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
  });
  f.findWorkspaceSymbols = async () => [
    {
      ...f.anchor,
      kind: "verified-file",
      origin: "workspace-symbol",
      line: 19,
      character: 12,
    },
  ];
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.deepEqual(
    f.seen.lsp.map((request) => request.kind),
    ["definition"],
  );
  assert.deepEqual(f.seen.lsp[0].position, f.anchor.position);
  assert.deepEqual(f.seen.opened, [
    { uri: "file:///project/src/math.ts", line: 10, character: 4 },
  ]);
  controller.dispose();
});

test("gr requests references separately from hover and definition", async () => {
  const { createNativeTranscriptController } = await native();
  const f = fixture();
  f.findWorkspaceSymbols = async () => {
    assert.fail("a known source position must not trigger workspace search");
  };
  f.lsp.query = async (request) => {
    f.seen.lsp.push(request);
    return [
      {
        uri: "file:///project/src/usage.ts",
        range: {
          start: { line: 7, character: 2 },
          end: { line: 7, character: 16 },
        },
      },
    ];
  };
  const controller = createNativeTranscriptController(f);
  await controller.invoke("references", f.snapshot);
  assert.deepEqual(
    f.seen.lsp.map((request) => request.kind),
    ["references"],
  );
  assert.deepEqual(f.seen.lsp[0].position, f.anchor.position);
  assert.deepEqual(f.seen.opened, [
    { uri: "file:///project/src/usage.ts", line: 7, character: 2 },
  ]);
  assert.deepEqual(f.seen.overlay, []);
  controller.dispose();
});

test("ambiguous workspace symbols use the existing location picker", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  const targets = [1, 2].map(
    (line) =>
      ({
        ...f.anchor,
        kind: "verified-file",
        origin: "workspace-symbol",
        uri: `file:///project/src/target${line}.ts`,
        position: { line, character: 3 },
        line,
        character: 3,
      }) satisfies SourceAnchor & NavigationLocation,
  );
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
  });
  f.findWorkspaceSymbols = async () => targets;
  f.lsp.query = async (request) => {
    f.seen.lsp.push(request);
    return {
      uri: request.uri,
      range: { start: request.position, end: request.position },
    };
  };
  let wrapped = 0;
  f.snapshot.withNavigationPicker = async (run) => {
    wrapped++;
    return run();
  };
  f.ui.custom = customUI(
    (factory) =>
      new Promise((done) => {
        const component = mountComponent(factory, done);
        component.handleInput("j");
        component.handleInput("\r");
      }),
  );
  const controller = createNativeTranscriptController(f);
  await controller.invoke("definition", f.snapshot);
  assert.equal(wrapped, 1);
  assert.deepEqual(f.seen.opened, [
    { uri: targets[1].uri, line: 2, character: 3 },
  ]);
  controller.dispose();
});

test("a workspace miss is reported without querying an isolated snippet", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
  });
  f.findWorkspaceSymbols = async () => [];
  const controller = createNativeTranscriptController(f);
  await controller.invoke("hover", f.snapshot);
  assert.match(
    f.seen.notifications[0],
    /No workspace symbol found for calculateTotal/,
  );
  assert.deepEqual(f.seen.lsp, []);
  assert.deepEqual(f.seen.overlay, []);
  controller.dispose();
});

test("workspace lookup cannot navigate after transcript focus changes", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  let release!: (
    value: Awaited<
      ReturnType<NonNullable<ControllerDependencies["findWorkspaceSymbols"]>>
    >,
  ) => void;
  let focused = true;
  f.snapshot.isCurrent = () => focused;
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
  });
  f.findWorkspaceSymbols = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const controller = createNativeTranscriptController(f),
    pending = controller.invoke("definition", f.snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  focused = false;
  release([
    {
      ...f.anchor,
      kind: "verified-file",
      origin: "workspace-symbol",
      line: f.anchor.position.line,
      character: f.anchor.position.character,
    },
  ]);
  await pending;
  assert.deepEqual(f.seen.opened, []);
  assert.deepEqual(f.seen.lsp, []);
  controller.dispose();
});

test("a workspace query without a lookup never reaches document LSP", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
    languageId: "typescript",
  });
  const controller = createNativeTranscriptController(f);
  await controller.invoke("hover", f.snapshot);
  assert.deepEqual(f.seen.lsp, []);
  assert.deepEqual(f.seen.overlay, []);
  assert.deepEqual(f.seen.opened, []);
  controller.dispose();
});

test("disposing during workspace lookup aborts it and suppresses late results", async () => {
  const { createNativeTranscriptController } = await native(),
    f = fixture();
  let release!: (value: (SourceAnchor & NavigationLocation)[]) => void;
  let signal!: AbortSignal;
  f.resolveSymbol = async () => ({
    kind: "workspace-symbol-query",
    token: "calculateTotal",
  });
  f.findWorkspaceSymbols = (_source, options) => {
    signal = options.signal;
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const controller = createNativeTranscriptController(f);
  const pending = controller.invoke("definition", f.snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  controller.dispose();
  assert.equal(signal.aborted, true);
  release([{ ...f.anchor, line: 19, character: 12 }]);
  await pending;
  assert.deepEqual(f.seen.lsp, []);
  assert.deepEqual(f.seen.overlay, []);
  assert.deepEqual(f.seen.opened, []);
});
