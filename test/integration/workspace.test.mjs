import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLspManager } from '../../src/runtime.mjs';

const typescript = fileURLToPath(new URL('../../node_modules/typescript', import.meta.url));

for (const languageId of [undefined, 'typescript']) {
  test(`real TypeScript workspace lookup finds imported method cold (${languageId ?? 'inferred language'})`, { timeout: 30000 }, async () => {
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-workspace-symbol-')));
    const manager = createLspManager({ cwd, config: { timeoutMs: 15000 } });
    try {
      await mkdir(path.join(cwd, 'node_modules'));
      await symlink(typescript, path.join(cwd, 'node_modules', 'typescript'), 'dir');
      await mkdir(path.join(cwd, 'src'));
      await writeFile(path.join(cwd, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['src/**/*.ts']
      }));
      const target = path.join(cwd, 'src', 'target.ts');
      const declaration = 'export class Target {\n  myMethod(): string { return "real method"; }\n}\n';
      await writeFile(target, declaration);
      await writeFile(path.join(cwd, 'src', 'index.ts'), 'import { Target } from "./target.js";\nnew Target().myMethod();\n');
      const symbols = await manager.workspaceSymbols({ query: 'myMethod', languageId });
      const symbol = symbols.find(entry => entry.name === 'myMethod' && entry.location.uri === pathToFileURL(target).href);
      assert.ok(symbol, 'first cold request must return the imported declaration, not a virtual file or an empty syntax result');
      assert.equal(symbol.kind, 6);
      assert.equal(symbol.location.range.start.line, 1);
      const line = (await readFile(fileURLToPath(symbol.location.uri), 'utf8')).split('\n')[1];
      assert.match(line.slice(symbol.location.range.start.character, symbol.location.range.end.character), /^myMethod\(\)/);
      assert.deepEqual(await manager.workspaceSymbols({ query: 'noSuchWorkspaceSymbol', languageId }), []);
      assert.equal(await readFile(target, 'utf8'), declaration);
    } finally {
      await manager.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
