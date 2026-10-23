import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSourceAnchor } from '../src/provenance.mjs';

const ROOT = '/work/repo';
const fileData = new Map([
  ['/work/repo/src/a.ts', 'export const start = 1;\nfunction work() {\n  return start;\n}\n'],
  ['/work/repo/src/repeated.ts', 'const a = 1;\nconst a = 1;\n'],
  ['/work/repo/src/changed.ts', 'const changed = true;\n'],
  ['/work/other/secret.ts', 'const secret = 1;\n'],
  ['/work/repo-evil/secret.ts', 'const secret = 1;\n']
]);
function fakeFs({ symlinks = {} } = {}) {
  return {
    async realpath(path) {
      const resolved = symlinks[path] ?? path;
      if (!fileData.has(resolved)) throw new Error('ENOENT');
      return resolved;
    },
    async readFile(path) {
      if (!fileData.has(path)) throw new Error('ENOENT');
      return fileData.get(path);
    }
  };
}
const block = code => ({ code, language: 'typescript', id: 'block-1' });
const selected = path => ({ kind: 'selected-file', path });

test('PR-01: exact contiguous snippet anchors at correct zero-based original line', async () => {
  const result = await resolveSourceAnchor({
    block: block('function work() {\n  return start;\n}'),
    root: ROOT, candidate: selected('src/a.ts'), fs: fakeFs()
  });
  assert.equal(result.kind, 'disk-verified');
  assert.equal(result.path, '/work/repo/src/a.ts');
  assert.equal(result.startLine, 1);
  assert.equal(result.startCharacter, 0);
});

test('PR-02: assistant file hint is never trusted', async () => {
  const result = await resolveSourceAnchor({
    block: block('function work() {\n  return start;\n}'),
    root: ROOT, candidate: { kind: 'assistant-hint', path: 'src/a.ts' }, fs: fakeFs()
  });
  assert.notEqual(result.kind, 'disk-verified');
});

test('PR-03: repeated snippet requires disambiguation', async () => {
  const result = await resolveSourceAnchor({
    block: block('const a = 1;'), root: ROOT,
    candidate: selected('src/repeated.ts'), fs: fakeFs()
  });
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.matches.length, 2);
});

test('PR-04: stale content does not become disk-verified', async () => {
  const result = await resolveSourceAnchor({
    block: block('const changed = false;'), root: ROOT,
    candidate: selected('src/changed.ts'), fs: fakeFs()
  });
  assert.notEqual(result.kind, 'disk-verified');
});

test('PR-05: code without a trusted source path stays unmapped and cannot jump', async () => {
  const result = await resolveSourceAnchor({ block: block('const x=1'), root: ROOT, fs: fakeFs() });
  assert.equal(result.kind, 'unmapped');
  assert.equal(result.path, undefined);
});

test('PR-06: path traversal and symlink escapes do not anchor', async () => {
  const traversed = await resolveSourceAnchor({
    block: block('const secret = 1;'), root: ROOT,
    candidate: selected('../other/secret.ts'), fs: fakeFs()
  });
  assert.notEqual(traversed.kind, 'disk-verified');
  const linked = await resolveSourceAnchor({
    block: block('const secret = 1;'), root: ROOT,
    candidate: selected('src/link.ts'),
    fs: fakeFs({ symlinks: { '/work/repo/src/link.ts': '/work/other/secret.ts' } })
  });
  assert.notEqual(linked.kind, 'disk-verified');
});

test('PR-07: workspace prefix collision must be rejected', async () => {
  const result = await resolveSourceAnchor({
    block: block('const secret = 1;'), root: '/work/repo',
    candidate: selected('/work/repo-evil/secret.ts'), fs: fakeFs()
  });
  assert.notEqual(result.kind, 'disk-verified');
});
