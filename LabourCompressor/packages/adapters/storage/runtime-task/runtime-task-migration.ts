import { createHash } from 'node:crypto';
import { copyFileSync } from 'node:fs';

import { createJsonRuntimeTaskStore } from './json-runtime-task-store.ts';
import { createSqliteRuntimeTaskStore } from './sqlite-runtime-task-store.ts';

interface MigratedTask {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
  readonly [key: string]: unknown;
}

export interface RuntimeTaskMigrationResult {
  readonly applied: boolean;
  readonly taskCount: number;
  readonly sourceHash: string;
  readonly targetHash?: string | undefined;
  readonly backupPath?: string | undefined;
}

export async function migrateRuntimeTasks(input: {
  readonly from: string;
  readonly to: string;
  readonly apply?: boolean | undefined;
  readonly replace?: boolean | undefined;
  readonly now?: Date | undefined;
  readonly verify?: ((source: readonly MigratedTask[], target: readonly MigratedTask[]) => void) | undefined;
}): Promise<RuntimeTaskMigrationResult> {
  const sourceTasks = createJsonRuntimeTaskStore<MigratedTask>({
    filePath: input.from,
    maxTasks: Number.MAX_SAFE_INTEGER
  }).load();
  validateTaskIdentities(sourceTasks);
  const sourceHash = hashTasks(sourceTasks);

  if (input.apply !== true) {
    return { applied: false, taskCount: sourceTasks.length, sourceHash };
  }

  const store = createSqliteRuntimeTaskStore<MigratedTask>({
    databasePath: input.to,
    maxTasks: Number.MAX_SAFE_INTEGER
  });
  try {
    const previousTasks = store.load();
    if (previousTasks.length > 0 && input.replace !== true) {
      throw new Error('Target SQLite store already contains tasks; pass --replace to overwrite it.');
    }
    const backupPath = createBackup(input.from, input.now ?? new Date());
    try {
      store.save(sourceTasks);
      const importedTasks = store.load();
      (input.verify ?? assertEquivalentTasks)(sourceTasks, importedTasks);
      return {
        applied: true,
        taskCount: sourceTasks.length,
        sourceHash,
        targetHash: hashTasks(importedTasks),
        backupPath
      };
    } catch (error) {
      store.save(previousTasks);
      throw error;
    }
  } finally {
    store.close();
  }
}

function createBackup(sourcePath: string, now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/gu, '-');
  const backupPath = `${sourcePath}.${timestamp}.bak`;
  copyFileSync(sourcePath, backupPath);
  return backupPath;
}

function validateTaskIdentities(tasks: readonly MigratedTask[]): void {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (typeof task.id !== 'string' || task.id.length === 0) {
      throw new Error('Every migrated runtime task requires a non-empty id.');
    }
    if (ids.has(task.id)) throw new Error(`Duplicate runtime task id: ${task.id}`);
    ids.add(task.id);
  }
}

function assertEquivalentTasks(
  source: readonly MigratedTask[],
  target: readonly MigratedTask[]
): void {
  const sourceIds = [...source].map(({ id }) => id).sort();
  const targetIds = [...target].map(({ id }) => id).sort();
  if (source.length !== target.length || JSON.stringify(sourceIds) !== JSON.stringify(targetIds)) {
    throw new Error('Runtime task migration verification failed: task IDs differ.');
  }
  if (hashTasks(source) !== hashTasks(target)) {
    throw new Error('Runtime task migration verification failed: payload hashes differ.');
  }
}

function hashTasks(tasks: readonly MigratedTask[]): string {
  const payload = [...tasks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((task) => `${task.id}\0${JSON.stringify(task)}`)
    .join('\n');
  return createHash('sha256').update(payload).digest('hex');
}
