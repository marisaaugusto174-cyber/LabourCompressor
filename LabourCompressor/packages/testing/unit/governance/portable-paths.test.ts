import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const SCAN_ROOTS = Object.freeze([
  'apps',
  'config',
  'scripts',
  'packages/testing/integration/phase4',
  'packages/testing/unit/cli/taxonomy-presets.test.ts',
  'packages/testing/unit/web/tag-review-ui.test.ts',
  'packages/testing/unit/web/v04-stage-ui.test.ts'
]);
const SCANNED_EXTENSIONS = new Set(['.ts', '.js', '.json', '.md', '.html', '.sh']);
const LOCAL_PATH_PATTERN = /\/Users\/tianyi\/(?:Desktop\/codex\/jobtask|Downloads)/u;

test('runtime code and active tests do not contain this checkout absolute path', async () => {
  const offenders: string[] = [];

  for (const scanRoot of SCAN_ROOTS) {
    const absoluteScanRoot = path.join(PROJECT_ROOT, scanRoot);

    for (const filePath of await collectFiles(absoluteScanRoot)) {
      if (!SCANNED_EXTENSIONS.has(path.extname(filePath))) {
        continue;
      }

      if (path.basename(filePath).endsWith('.local.json')) {
        continue;
      }

      const source = await readFile(filePath, 'utf8');

      if (LOCAL_PATH_PATTERN.test(source)) {
        offenders.push(path.relative(PROJECT_ROOT, filePath));
      }
    }
  }

  assert.deepEqual(offenders, []);
});

async function collectFiles(filePath: string): Promise<readonly string[]> {
  const entries = await readdir(filePath, { withFileTypes: true }).catch(() => undefined);

  if (entries === undefined) {
    return [filePath];
  }

  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(filePath, entry.name);

    if (entry.isDirectory()) {
      files.push(...await collectFiles(entryPath));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}
