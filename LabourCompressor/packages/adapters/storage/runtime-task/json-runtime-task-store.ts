import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  RuntimeTaskStoreError,
  type RuntimeTaskStore
} from '../../../orchestrator/index.ts';

export function createJsonRuntimeTaskStore<TTask>(options: {
  readonly filePath: string;
  readonly maxTasks?: number | undefined;
  readonly fileOperations?: JsonStoreFileOperations | undefined;
}): RuntimeTaskStore<TTask> {
  return Object.freeze({
    load: () => loadJsonTasks<TTask>(options.filePath),
    save: (tasks: readonly TTask[]) => saveJsonTasks(
      options.filePath,
      tasks.slice(0, options.maxTasks ?? 50),
      options.fileOperations ?? NATIVE_FILE_OPERATIONS
    )
  });
}

function loadJsonTasks<TTask>(filePath: string): readonly TTask[] {
  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw new RuntimeTaskStoreError(
      'runtime-task-store-read-failed',
      'Runtime task JSON store could not be read.',
      { cause: error }
    );
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!isTaskEnvelope(parsed)) throw new Error('Expected an object with a tasks array.');
    return Object.freeze([...parsed.tasks] as TTask[]);
  } catch (error) {
    throw new RuntimeTaskStoreError(
      'runtime-task-store-invalid-json',
      'Runtime task JSON store is invalid and was left unchanged.',
      { cause: error }
    );
  }
}

interface JsonStoreFileOperations {
  write(filePath: string, content: string): void;
  rename(sourcePath: string, targetPath: string): void;
  remove(filePath: string): void;
}

const NATIVE_FILE_OPERATIONS: JsonStoreFileOperations = Object.freeze({
  write: (filePath: string, content: string) => writeFileSync(filePath, content, 'utf8'),
  rename: renameSync,
  remove: (filePath: string) => rmSync(filePath, { force: true })
});

function saveJsonTasks<TTask>(
  filePath: string,
  tasks: readonly TTask[],
  fileOperations: JsonStoreFileOperations
): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fileOperations.write(temporaryPath, `${JSON.stringify({ tasks }, null, 2)}\n`);
    fileOperations.rename(temporaryPath, filePath);
  } catch (error) {
    fileOperations.remove(temporaryPath);
    throw new RuntimeTaskStoreError(
      'runtime-task-store-write-failed',
      'Runtime task JSON store could not be written atomically.',
      { cause: error }
    );
  }
}

function isTaskEnvelope(value: unknown): value is { readonly tasks: readonly unknown[] } {
  return typeof value === 'object' && value !== null &&
    'tasks' in value && Array.isArray(Reflect.get(value, 'tasks'));
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}
