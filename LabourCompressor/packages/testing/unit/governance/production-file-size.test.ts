import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOTS = ['apps', 'packages'];

test('production TypeScript and JavaScript modules stay within 500 lines', async () => {
  const oversized: string[] = [];
  for (const root of ROOTS) {
    for (const filePath of await collectSourceFiles(root)) {
      if (filePath.includes('/testing/')) continue;
      const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/u).length;
      if (lines > 500) oversized.push(`${filePath}: ${lines}`);
    }
  }
  assert.deepEqual(oversized, []);
});

async function collectSourceFiles(directory: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await collectSourceFiles(entryPath));
    else if (/\.(?:ts|js)$/u.test(entry.name)) output.push(entryPath);
  }
  return output;
}
