import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { migrateRuntimeTasks } from '../../../adapters/storage/runtime-task/runtime-task-migration.ts';
import { createSqliteRuntimeTaskStore } from '../../../adapters/storage/runtime-task/sqlite-runtime-task-store.ts';

test('runtime task migration defaults to dry-run without creating SQLite', async () => {
  const fixture = createFixture();
  try {
    const result = await migrateRuntimeTasks({ from: fixture.jsonPath, to: fixture.databasePath });
    assert.equal(result.applied, false);
    assert.equal(result.taskCount, 2);
    assert.equal(existsSync(fixture.databasePath), false);
  } finally {
    fixture.cleanup();
  }
});

test('runtime task migration backs up JSON and verifies imported payloads', async () => {
  const fixture = createFixture();
  try {
    const result = await migrateRuntimeTasks({
      from: fixture.jsonPath,
      to: fixture.databasePath,
      apply: true,
      now: new Date('2026-06-28T12:34:56.000Z')
    });
    assert.equal(result.applied, true);
    assert.equal(result.taskCount, 2);
    assert.equal(result.sourceHash, result.targetHash);
    assert.equal(readdirSync(fixture.directory).some((name) => name.endsWith('.bak')), true);
    const store = createSqliteRuntimeTaskStore<TestTask>({ databasePath: fixture.databasePath });
    assert.deepEqual(store.load().map(({ id }) => id), ['a', 'b']);
    store.close();
  } finally {
    fixture.cleanup();
  }
});

test('runtime task migration refuses a populated target without replace', async () => {
  const fixture = createFixture();
  try {
    const store = createSqliteRuntimeTaskStore<TestTask>({ databasePath: fixture.databasePath });
    store.save([{ id: 'existing', status: 'queued', createdAt: '2026-01-01T00:00:00Z' }]);
    store.close();
    await assert.rejects(
      migrateRuntimeTasks({ from: fixture.jsonPath, to: fixture.databasePath, apply: true }),
      /already contains tasks/u
    );
  } finally {
    fixture.cleanup();
  }
});

test('runtime task migration restores the prior target when verification fails', async () => {
  const fixture = createFixture();
  try {
    const store = createSqliteRuntimeTaskStore<TestTask>({ databasePath: fixture.databasePath });
    const existing = { id: 'existing', status: 'queued', createdAt: '2026-01-01T00:00:00Z' };
    store.save([existing]);
    store.close();
    await assert.rejects(migrateRuntimeTasks({
      from: fixture.jsonPath,
      to: fixture.databasePath,
      apply: true,
      replace: true,
      verify: () => { throw new Error('verification failed'); }
    }), /verification failed/u);
    const restored = createSqliteRuntimeTaskStore<TestTask>({ databasePath: fixture.databasePath });
    assert.deepEqual(restored.load(), [existing]);
    restored.close();
  } finally {
    fixture.cleanup();
  }
});

interface TestTask {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
}

function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-task-migration-'));
  const jsonPath = path.join(directory, 'tasks.json');
  const databasePath = path.join(directory, 'tasks.sqlite');
  writeFileSync(jsonPath, JSON.stringify({ tasks: [
    { id: 'a', status: 'succeeded', createdAt: '2026-06-28T01:00:00Z' },
    { id: 'b', status: 'failed', createdAt: '2026-06-28T02:00:00Z' }
  ] }), 'utf8');
  return {
    directory,
    jsonPath,
    databasePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true })
  };
}
