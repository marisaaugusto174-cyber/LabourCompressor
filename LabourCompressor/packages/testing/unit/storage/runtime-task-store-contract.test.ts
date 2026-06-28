import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createJsonRuntimeTaskStore } from '../../../adapters/storage/runtime-task/json-runtime-task-store.ts';
import { createSqliteRuntimeTaskStore } from '../../../adapters/storage/runtime-task/sqlite-runtime-task-store.ts';
import { type RuntimeTaskStore } from '../../../orchestrator/index.ts';

for (const kind of ['json', 'sqlite'] as const) {
  test(`${kind} runtime task store satisfies the shared snapshot contract`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), `lc-${kind}-contract-`));
    const resourcePath = path.join(directory, kind === 'json' ? 'tasks.json' : 'tasks.sqlite');
    const store = createStore(kind, resourcePath);
    try {
      assert.deepEqual(store.load(), []);
      store.save([task('a', 'queued'), task('b', 'running')]);
      assert.deepEqual(store.load().map(({ id }) => id), ['a', 'b']);
      store.save([task('a', 'succeeded')]);
      assert.deepEqual(store.load(), [task('a', 'succeeded')]);
    } finally {
      if ('close' in store) store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

interface ContractTask {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly events: readonly string[];
}

function task(id: string, status: string): ContractTask {
  return { id, status, createdAt: '2026-06-28T00:00:00.000Z', events: [`${id}:${status}`] };
}

function createStore(kind: 'json' | 'sqlite', resourcePath: string):
  RuntimeTaskStore<ContractTask> & Partial<{ close(): void }> {
  return kind === 'json'
    ? createJsonRuntimeTaskStore({ filePath: resourcePath })
    : createSqliteRuntimeTaskStore({ databasePath: resourcePath });
}
