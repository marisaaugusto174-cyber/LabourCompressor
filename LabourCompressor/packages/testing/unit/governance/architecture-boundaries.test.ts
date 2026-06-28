import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const WEB_SERVER_PATH = path.join(PROJECT_ROOT, 'apps/web/server.ts');
const PIPELINE_ROOT = path.join(PROJECT_ROOT, 'apps/cli/pipeline');
const ORCHESTRATOR_ROOT = path.join(PROJECT_ROOT, 'packages/orchestrator');
const WEB_ROUTE_ROOT = path.join(PROJECT_ROOT, 'apps/web/api/routes');
const MAX_WEB_SERVER_LINES = 120;
const MAX_LOCAL_PIPELINE_STAGE_ENTRY_LINES = 180;
const ALLOWED_ROUTE_CLI_IMPORTS = new Set([
  '../../../cli/partial-tagging-writeback.ts',
  '../../../cli/pipeline/options.ts',
  '../../../cli/project-paths.ts',
  '../../../cli/taxonomy-presets.ts'
]);

test('web server remains a thin startup and route registration entrypoint', async () => {
  const source = await readFile(WEB_SERVER_PATH, 'utf8');

  assert.ok(
    countLines(source) <= MAX_WEB_SERVER_LINES,
    `apps/web/server.ts has ${countLines(source)} lines; keep request handling in apps/web/api/routes.`
  );
  assert.doesNotMatch(source, /url\.pathname\s*===/);
  assert.doesNotMatch(source, /request\.method\s*===/);
});

test('local pipeline stage entry remains orchestration-only', async () => {
  const source = await readFile(path.join(PROJECT_ROOT, 'apps/cli/local-pipeline-stages.ts'), 'utf8');

  assert.ok(
    countLines(source) <= MAX_LOCAL_PIPELINE_STAGE_ENTRY_LINES,
    'apps/cli/local-pipeline-stages.ts should delegate stage implementations to apps/cli/pipeline/stages.'
  );
  assert.doesNotMatch(source, /async function run(?:Download|Segment|Compress|Tag|Archive)Stage/);
});

test('pipeline modules do not import web modules', async () => {
  const offenders: string[] = [];

  for (const filePath of await collectFiles(PIPELINE_ROOT)) {
    if (path.extname(filePath) !== '.ts') {
      continue;
    }
    const source = await readFile(filePath, 'utf8');

    if (/from ['"][^'"]*(?:apps\/web|\.\.\/web|\.\.\/\.\.\/web|\.\.\/\.\.\/\.\.\/web)/.test(source)) {
      offenders.push(path.relative(PROJECT_ROOT, filePath));
    }
  }

  assert.deepEqual(offenders, []);
});

test('orchestrator does not import apps or concrete adapters', async () => {
  const offenders: string[] = [];
  for (const filePath of await collectFiles(ORCHESTRATOR_ROOT)) {
    if (path.extname(filePath) !== '.ts') continue;
    const source = await readFile(filePath, 'utf8');
    if (/from ['"][^'"]*(?:apps\/|adapters\/)/u.test(source)) {
      offenders.push(path.relative(PROJECT_ROOT, filePath));
    }
  }
  assert.deepEqual(offenders, []);
});

test('web routes do not directly import heavy cli internals', async () => {
  const offenders: string[] = [];
  const importPattern = /from ['"]([^'"]*cli\/[^'"]+)['"]/g;

  for (const filePath of await collectFiles(WEB_ROUTE_ROOT)) {
    if (path.extname(filePath) !== '.ts') {
      continue;
    }
    const source = await readFile(filePath, 'utf8');

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];

      if (!ALLOWED_ROUTE_CLI_IMPORTS.has(specifier)) {
        offenders.push(`${path.relative(PROJECT_ROOT, filePath)} imports ${specifier}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

function countLines(source: string): number {
  return source.split(/\r?\n/u).length;
}

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
