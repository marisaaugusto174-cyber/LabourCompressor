import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSqliteRuntimeTaskStore } from '../../../adapters/storage/runtime-task/sqlite-runtime-task-store.ts';

test('SQLite task store saves, updates, and restores complete payloads', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-sqlite-store-'));
  const databasePath = path.join(directory, 'tasks.sqlite');
  try {
    const store = createSqliteRuntimeTaskStore<TestTask>({ databasePath });
    assert.deepEqual(store.load(), []);
    store.save([task('a', 'queued'), task('b', 'running')]);
    store.save([task('a', 'succeeded'), task('b', 'failed')]);
    assert.deepEqual(store.load(), [task('a', 'succeeded'), task('b', 'failed')]);
    store.close();

    const restored = createSqliteRuntimeTaskStore<TestTask>({ databasePath });
    assert.deepEqual(restored.load(), [task('a', 'succeeded'), task('b', 'failed')]);
    restored.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite task store rolls back a failed snapshot transaction', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-sqlite-rollback-'));
  const databasePath = path.join(directory, 'tasks.sqlite');
  try {
    const store = createSqliteRuntimeTaskStore<object>({ databasePath });
    store.save([task('a', 'queued')]);
    assert.throws(() => store.save([{}]), /rolled back/u);
    assert.deepEqual(store.load(), [task('a', 'queued')]);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface TestTask {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly nested: Readonly<{ readonly optional?: string }>;
}

function task(id: string, status: string): TestTask {
  return { id, status, createdAt: `2026-06-28T00:00:0${id.charCodeAt(0)}Z`, nested: { optional: id } };
}
