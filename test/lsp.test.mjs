import test from 'node:test';
import assert from 'node:assert/strict';
import { createLspSession } from '../src/lsp.mjs';

function fakeTransport(respond = async () => null) {
  const requests = [];
  const notifications = [];
  return {
    requests, notifications,
    async request(method, params, options) {
      requests.push({ method, params, options });
      return respond(method, params, options);
    },
    async notify(method, params) { notifications.push({ method, params }); }
  };
}
const rootUri = 'file:///project';
const uri = 'file:///project/src/a.ts';
const text = 'const value = 1;\n';
const position = { line: 0, character: 6 };
const capabilities = {
  hoverProvider: true, definitionProvider: true,
  referencesProvider: true, completionProvider: {},
  textDocumentSync: 1, positionEncoding: 'utf-16'
};

test('LS-01: initializes protocol then notifies initialized and opens snapshot', async () => {
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities } : null);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  assert.equal(transport.requests[0].method, 'initialize');
  assert.equal(transport.requests[0].params.rootUri, rootUri);
  assert.deepEqual(transport.requests[0].params.capabilities.general.positionEncodings, ['utf-16']);
  assert.equal(client.positionEncoding, 'utf-16');
  assert.equal(transport.notifications[0].method, 'initialized');
  assert.equal(transport.notifications[1].method, 'textDocument/didOpen');
  assert.equal(transport.notifications[1].params.textDocument.uri, uri);
  assert.equal(transport.notifications[1].params.textDocument.text, text);
});

test('LS-02: hover requests exact active URI and zero-based LSP position', async () => {
  const response = { contents: { kind: 'markdown', value: '**value**: number' } };
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities } : response);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  assert.deepEqual(await client.hover({ uri, position }), response);
  const request = transport.requests.find(x => x.method === 'textDocument/hover');
  assert.deepEqual(request.params.position, position);
  assert.equal(request.params.textDocument.uri, uri);
});

test('LS-03: definition and references use distinct LSP methods', async () => {
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities } : []);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  await client.definition({ uri, position });
  await client.references({ uri, position, includeDeclaration: true });
  assert.ok(transport.requests.some(x => x.method === 'textDocument/definition'));
  const refs = transport.requests.find(x => x.method === 'textDocument/references');
  assert.deepEqual(refs.params.context, { includeDeclaration: true });
});

test('LS-04: completion is query-only; client never sends an edit to source', async () => {
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities } : { isIncomplete: false, items: [{ label: 'value' }] });
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  const result = await client.completion({ uri, position });
  assert.equal(result.items[0].label, 'value');
  assert.ok(transport.requests.some(x => x.method === 'textDocument/completion'));
  assert.ok(!transport.notifications.some(x => x.method === 'workspace/applyEdit'));
});

test('LS-05: unsupported LSP capability is surfaced, not synthesized by the model', async () => {
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities: { textDocumentSync: 1 } } : null);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  await assert.rejects(() => client.definition({ uri, position }), /unsupported|capability|definition/i);
});

test('LS-06: shutdown closes document before shutdown and exit', async () => {
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities } : null);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  await client.dispose();
  assert.ok(transport.notifications.some(x => x.method === 'textDocument/didClose'));
  assert.ok(transport.requests.some(x => x.method === 'shutdown'));
  assert.ok(transport.notifications.some(x => x.method === 'exit'));
});

test('LS-07: pending request observes cancellation', async () => {
  const transport = fakeTransport(async (method, _params, options) => {
    if (method === 'initialize') return { capabilities };
    if (method !== 'textDocument/hover') return null;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await client.open({ uri, text, version: 1 });
  const ac = new AbortController();
  const request = client.hover({ uri, position, signal: ac.signal });
  ac.abort();
  await assert.rejects(request, /abort|cancel/i);
});

test('LS-08: omitted position encoding defaults to UTF-16', async () => {
  const transport = fakeTransport(async () => ({ capabilities: { hoverProvider: true } }));
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  assert.equal(client.positionEncoding, 'utf-16');
  await client.open({ uri, text: '😀value' });
  await client.hover({ uri, position: { line: 0, character: 2 } });
  assert.deepEqual(transport.requests[1].params.position, { line: 0, character: 2 });
});

for (const encoding of ['utf-8', 'utf-32']) {
  test(`LS-09: rejects explicit ${encoding} negotiation before opening documents`, async () => {
    const transport = fakeTransport(async () => ({ capabilities: { ...capabilities, positionEncoding: encoding } }));
    const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
    await assert.rejects(client.initialize(), /Unsupported LSP position encoding/);
    await assert.rejects(client.open({ uri, text }), /not initialized/);
    assert.deepEqual(transport.notifications, []);
  });
}

test('LS-10: workspace symbols need no open document and preserve real locations', async () => {
  const symbols = [{ name: 'myMethod', kind: 6, location: { uri, range: { start: position, end: { line: 0, character: 14 } } } }];
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities: { workspaceSymbolProvider: true } } : symbols);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript', timeoutMs: 1234 });
  const signal = new AbortController().signal;
  await client.initialize();
  assert.deepEqual(transport.requests[0].params.initializationOptions, { tsserver: { useSyntaxServer: 'never' } });
  assert.deepEqual(transport.requests[0].params.capabilities.workspace.symbol.resolveSupport, { properties: ['location.range'] });
  assert.deepEqual(await client.workspaceSymbols('myMethod', { signal }), symbols);
  assert.deepEqual(transport.requests[1], { method: 'workspace/symbol', params: { query: 'myMethod' }, options: { signal, timeoutMs: 1234 } });
  assert.deepEqual(transport.notifications.map(event => event.method), ['initialized']);
});

test('LS-11: workspace symbols resolve range-less locations and discard unresolved entries', async () => {
  const unresolved = { name: 'myMethod', kind: 6, location: { uri }, data: { id: 7 } };
  const resolved = { ...unresolved, location: { uri, range: { start: position, end: position } } };
  const transport = fakeTransport(async (method, params) => {
    if (method === 'initialize') return { capabilities: { workspaceSymbolProvider: { resolveProvider: true } } };
    if (method === 'workspace/symbol') return [unresolved, { ...unresolved, data: { id: 8 } }, resolved];
    if (method === 'workspaceSymbol/resolve') return params.data.id === 7 ? resolved : params;
  });
  const client = createLspSession({ transport, rootUri, languageId: 'python' });
  const signal = new AbortController().signal;
  await client.initialize();
  assert.equal(transport.requests[0].params.initializationOptions, undefined);
  assert.deepEqual(await client.workspaceSymbols('myMethod', { signal }), [resolved, resolved]);
  const requests = transport.requests.filter(event => event.method === 'workspaceSymbol/resolve');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].params, unresolved);
  assert.equal(requests[0].options.signal, signal);
});

test('LS-12: range-less workspace symbols without resolve support are filtered, null means no matches', async () => {
  let result = [{ name: 'myMethod', location: { uri } }];
  const transport = fakeTransport(async method => method === 'initialize' ? { capabilities: { workspaceSymbolProvider: true } } : result);
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  assert.deepEqual(await client.workspaceSymbols('myMethod'), []);
  result = null;
  assert.deepEqual(await client.workspaceSymbols('missing'), []);
  assert.ok(!transport.requests.some(event => event.method === 'workspaceSymbol/resolve'));
});

test('LS-13: workspace lookup checks readiness and advertised capability', async () => {
  const transport = fakeTransport(async () => ({ capabilities: {} }));
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await assert.rejects(client.workspaceSymbols('myMethod'), /not initialized/);
  await client.initialize();
  await assert.rejects(client.workspaceSymbols('myMethod'), /workspaceSymbolProvider/);
  assert.equal(transport.requests.length, 1);
});

test('LS-14: workspace lookup forwards cancellation to symbol resolution', async () => {
  const controller = new AbortController();
  const transport = fakeTransport(async (method, _params, options) => {
    if (method === 'initialize') return { capabilities: { workspaceSymbolProvider: { resolveProvider: true } } };
    if (method === 'workspace/symbol') return [{ name: 'myMethod', location: { uri } }];
    if (method === 'workspaceSymbol/resolve') return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      controller.abort();
    });
  });
  const client = createLspSession({ transport, rootUri, languageId: 'typescript' });
  await client.initialize();
  await assert.rejects(client.workspaceSymbols('myMethod', { signal: controller.signal }), /cancelled/);
});
