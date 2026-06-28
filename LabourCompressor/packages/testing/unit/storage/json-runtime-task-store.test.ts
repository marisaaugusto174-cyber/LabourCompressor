import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createJsonRuntimeTaskStore } from '../../../adapters/storage/runtime-task/json-runtime-task-store.ts';

test('JSON task store loads empty state and restores saved tasks', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-json-store-'));
  const filePath = path.join(directory, 'tasks.json');
  try {
    const store = createJsonRuntimeTaskStore<TestTask>({ filePath });
    assert.deepEqual(store.load(), []);
    store.save([task('a', 'queued'), task('b', 'succeeded')]);
    assert.deepEqual(store.load().map(({ id }) => id), ['a', 'b']);
    assert.equal(readFileSync(filePath, 'utf8').endsWith('\n'), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('JSON task store replaces same-id snapshots and enforces retention', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-json-store-limit-'));
  const filePath = path.join(directory, 'tasks.json');
  try {
    const store = createJsonRuntimeTaskStore<TestTask>({ filePath, maxTasks: 2 });
    store.save([task('a', 'running'), task('b', 'queued'), task('c', 'queued')]);
    store.save([task('a', 'succeeded'), task('b', 'failed')]);
    assert.deepEqual(store.load().map(({ id, status }) => [id, status]), [
      ['a', 'succeeded'], ['b', 'failed']
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('JSON task store classifies corrupt state without overwriting it', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-json-store-corrupt-'));
  const filePath = path.join(directory, 'tasks.json');
  try {
    writeFileSync(filePath, '{broken', 'utf8');
    const store = createJsonRuntimeTaskStore<TestTask>({ filePath });
    assert.throws(() => store.load(), (error: unknown) =>
      error instanceof Error &&
      Reflect.get(error, 'code') === 'runtime-task-store-invalid-json'
    );
    assert.equal(readFileSync(filePath, 'utf8'), '{broken');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('JSON task store keeps the prior snapshot when atomic rename fails', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lc-json-store-atomic-'));
  const filePath = path.join(directory, 'tasks.json');
  try {
    createJsonRuntimeTaskStore<TestTask>({ filePath }).save([task('a', 'queued')]);
    const failingStore = createJsonRuntimeTaskStore<TestTask>({
      filePath,
      fileOperations: {
        write: (target, content) => writeFileSync(target, content, 'utf8'),
        rename: () => { throw new Error('rename failed'); },
        remove: (target) => rmSync(target, { force: true })
      }
    });
    assert.throws(() => failingStore.save([task('b', 'failed')]), /atomically/u);
    assert.deepEqual(createJsonRuntimeTaskStore<TestTask>({ filePath }).load().map(({ id }) => id), ['a']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface TestTask {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly payload: string;
}

function task(id: string, status: string): TestTask {
  return { id, status, createdAt: `2026-06-28T00:00:0${id.charCodeAt(0)}Z`, payload: id };
}
