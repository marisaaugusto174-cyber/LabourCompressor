import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  RuntimeTaskStoreError,
  type RuntimeTaskStore
} from '../../../orchestrator/index.ts';

export interface SqliteRuntimeTaskStore<TTask> extends RuntimeTaskStore<TTask> {
  close(): void;
}

export function createSqliteRuntimeTaskStore<TTask extends object>(options: {
  readonly databasePath: string;
  readonly maxTasks?: number | undefined;
}): SqliteRuntimeTaskStore<TTask> {
  mkdirSync(path.dirname(options.databasePath), { recursive: true });
  const database = new DatabaseSync(options.databasePath);
  initializeDatabase(database);
  return Object.freeze({
    load: () => loadTasks<TTask>(database),
    save: (tasks: readonly TTask[]) => saveTasks(
      database,
      tasks.slice(0, options.maxTasks ?? 50)
    ),
    close: () => database.close()
  });
}

function initializeDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
    INSERT INTO schema_meta(version)
      SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
    CREATE TABLE IF NOT EXISTS runtime_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS runtime_tasks_status_idx ON runtime_tasks(status);
    CREATE INDEX IF NOT EXISTS runtime_tasks_created_at_idx ON runtime_tasks(created_at);
  `);
}

function loadTasks<TTask>(database: DatabaseSync): readonly TTask[] {
  try {
    const rows = database.prepare(
      'SELECT payload_json FROM runtime_tasks ORDER BY rowid ASC'
    ).all();
    return Object.freeze(rows.map((row) => {
      const payload = row.payload_json;
      if (typeof payload !== 'string') throw new Error('SQLite task payload must be text.');
      return JSON.parse(payload) as TTask;
    }));
  } catch (error) {
    throw new RuntimeTaskStoreError(
      'runtime-task-store-sqlite-read-failed',
      'Runtime task SQLite store could not be read.',
      { cause: error }
    );
  }
}

function saveTasks<TTask extends object>(database: DatabaseSync, tasks: readonly TTask[]): void {
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM runtime_tasks');
    const insert = database.prepare(
      'INSERT INTO runtime_tasks(id, status, created_at, payload_json) VALUES (?, ?, ?, ?)'
    );
    for (const task of tasks) {
      const fields = readTaskFields(task);
      insert.run(fields.id, fields.status, fields.createdAt, JSON.stringify(task));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw new RuntimeTaskStoreError(
      'runtime-task-store-sqlite-write-failed',
      'Runtime task SQLite transaction was rolled back.',
      { cause: error }
    );
  }
}

function readTaskFields(task: object): {
  readonly id: string;
  readonly status: string;
  readonly createdAt: string;
} {
  const id = Reflect.get(task, 'id');
  const status = Reflect.get(task, 'status');
  const createdAt = Reflect.get(task, 'createdAt');
  if (typeof id !== 'string' || typeof status !== 'string' || typeof createdAt !== 'string') {
    throw new Error('Runtime task requires string id, status, and createdAt fields.');
  }
  return { id, status, createdAt };
}
