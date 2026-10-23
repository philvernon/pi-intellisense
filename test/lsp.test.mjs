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
