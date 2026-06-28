import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createJsonRuntimeTaskStore } from '../../../adapters/storage/runtime-task/json-runtime-task-store.ts';
import { createSqliteRuntimeTaskStore } from '../../../adapters/storage/runtime-task/sqlite-runtime-task-store.ts';
import {
  createRuntimeTaskService,
  type PersistedRuntimeTask,
  type RuntimeTaskStore
} from '../../../orchestrator/index.ts';

for (const kind of ['json', 'sqlite'] as const) {
  test(`${kind} store preserves runtime task completion and cancellation`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), `lc-service-${kind}-`));
    const store = createStore(kind, path.join(directory, kind === 'json' ? 'tasks.json' : 'tasks.sqlite'));
    try {
      const completedService = createService(store, async () => ({ value: 'done' }));
      const completed = await completedService.startTask({ mode: 'complete' });
      assert.equal((await waitForTerminal(completedService, completed.id)).status, 'succeeded');

      const pausingService = createService(store, async ({ control }) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await control.waitIfPaused();
        return { value: 'resumed' };
      });
      const pausing = await pausingService.startTask({ mode: 'pause' });
      pausingService.pauseTask(pausing.id);
      assert.equal((await waitForStatus(pausingService, pausing.id, 'paused')).status, 'paused');
      pausingService.resumeTask(pausing.id);
      assert.equal((await waitForTerminal(pausingService, pausing.id)).status, 'succeeded');

      const cancelledService = createService(store, async ({ control }) => {
        await new Promise<void>((resolve, reject) => {
          control.signal.addEventListener('abort', () => reject(control.createAbortError()), { once: true });
        });
        return { value: 'unexpected' };
      });
      const cancelled = await cancelledService.startTask({ mode: 'cancel' });
      cancelledService.stopTask(cancelled.id);
      assert.equal((await waitForTerminal(cancelledService, cancelled.id)).status, 'cancelled');
    } finally {
      if ('close' in store) store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

interface Options { readonly mode: string }
interface Result { readonly value: string }
interface Event { readonly message: string }
type Task = PersistedRuntimeTask<Options, Result, Event>;

function createService(
  store: RuntimeTaskStore<Task>,
  runner: Parameters<typeof createRuntimeTaskService<Options, Result, Event>>[0]['runner']
) {
  return createRuntimeTaskService({
    runner,
    normalizeEvent: (event) => event,
    createLifecycleEvent: ({ message }) => ({ message }),
    createAbortError: () => new Error('cancelled'),
    isCancelledError: (error) => error instanceof Error && error.message === 'cancelled',
    persistence: store
  });
}

function createStore(kind: 'json' | 'sqlite', resourcePath: string):
  RuntimeTaskStore<Task> & Partial<{ close(): void }> {
  return kind === 'json'
    ? createJsonRuntimeTaskStore({ filePath: resourcePath })
    : createSqliteRuntimeTaskStore({ databasePath: resourcePath });
}

async function waitForTerminal(
  service: ReturnType<typeof createService>,
  taskId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = service.getTask(taskId);
    if (task !== undefined && ['succeeded', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${taskId}.`);
}

async function waitForStatus(
  service: ReturnType<typeof createService>,
  taskId: string,
  status: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = service.getTask(taskId);
    if (task?.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${taskId} to become ${status}.`);
}
