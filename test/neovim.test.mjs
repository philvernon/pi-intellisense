import test from 'node:test';
import assert from 'node:assert/strict';
import { openInNeovim } from '../src/neovim.mjs';

function fakeRpc({ failure } = {}) {
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push({ method, params });
      if (failure) throw failure;
      return true;
    }
  };
}
const fs = {
  async readFile(path) {
    if (path === '/project/src/é | evil.ts') return 'é🙂symbol\nmore\n';
    return 'zero\nfunction target() {}\n';
  }
};
const socket = '/tmp/nvim-listen.sock';
const location = { path: '/project/src/a.ts', line: 1, character: 9, encoding: 'utf-16' };

test('NV-01: open calls Neovim RPC with a constant Lua chunk and separate pathname parameter', async () => {
  const rpc = fakeRpc();
  await openInNeovim({ location, socket, rpc, fs });
  assert.equal(rpc.calls.length, 1);
  assert.equal(rpc.calls[0].method, 'nvim_exec_lua');
  const [chunk, args] = rpc.calls[0].params;
  assert.equal(typeof chunk, 'string');
  assert.ok(Array.isArray(args));
  assert.ok(args.includes('/project/src/a.ts'));
  assert.ok(!chunk.includes('/project/src/a.ts'));
  assert.ok(args.includes(2)); // LSP line 1 -> Nvim line 2.
});

test('NV-02: path containing Ex separators is never interpolated into Lua or shell', async () => {
  const rpc = fakeRpc();
  const malicious = '/project/src/é | evil.ts';
  await openInNeovim({ location: { path: malicious, line: 0, character: 3, encoding: 'utf-16' }, socket, rpc, fs });
  const [chunk, args] = rpc.calls[0].params;
  assert.ok(args.includes(malicious));
  assert.ok(!chunk.includes(malicious));
  assert.equal(rpc.calls.length, 1);
});

test('NV-03: unicode prefix converts UTF-16 to exact Nvim byte column', async () => {
  const rpc = fakeRpc();
  const result = await openInNeovim({
    location: { path: '/project/src/é | evil.ts', line: 0, character: 3, encoding: 'utf-16' },
    socket, rpc, fs
  });
  assert.equal(result.column, 6); // é two bytes, 🙂 four bytes.
  assert.ok(rpc.calls[0].params[1].includes(6));
});

test('NV-04: absent socket is explicit error, never a request to start new Neovim', async () => {
  const rpc = fakeRpc();
  await assert.rejects(() => openInNeovim({ location, socket: null, rpc, fs }), /socket|server|Neovim/i);
  assert.equal(rpc.calls.length, 0);
});

test('NV-05: RPC connection errors propagate and do not trigger a second attempt via a shell', async () => {
  const rpc = fakeRpc({ failure: new Error('ECONNREFUSED') });
  await assert.rejects(() => openInNeovim({ location, socket, rpc, fs }), /ECONNREFUSED/);
  assert.equal(rpc.calls.length, 1);
});

test('NV-06: invalid character position cannot direct Neovim to unintended column', async () => {
  const rpc = fakeRpc();
  await assert.rejects(() => openInNeovim({
    location: { path: '/project/src/a.ts', line: 1, character: 999, encoding: 'utf-16' },
    socket, rpc, fs
  }), /invalid|range|column/i);
  assert.equal(rpc.calls.length, 0);
});
