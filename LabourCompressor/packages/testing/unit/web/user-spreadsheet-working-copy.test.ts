import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildUserSpreadsheetWorkingCopyPath,
  prepareUserSpreadsheetWorkingCopy,
  WorkingCopyNameConflictError
} from '../../../../apps/web/user-spreadsheet-working-copy.ts';

const TASK_ID = 'a1b2c3d4-0000-0000-0000-000000000000';
const CREATED_AT = '2026-06-29T16:30:15';

test('creates a writable working copy beside a read-only user spreadsheet', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'spreadsheet-copy-'));
  const source = path.join(tempDir, '测试 集_O2.xlsx');
  try {
    await writeFile(source, 'source-bytes');
    await chmod(source, 0o444);

    const prepared = await prepareUserSpreadsheetWorkingCopy({
      taskId: TASK_ID,
      createdAt: CREATED_AT,
      options: createOptions(source)
    });

    assert.equal(path.dirname(prepared.spreadsheet), tempDir);
    assert.equal(
      path.basename(prepared.spreadsheet),
      '测试_集_O2_任务副本_20260629_163015_a1b2c3d4.xlsx'
    );
    assert.equal(await readFile(source, 'utf8'), 'source-bytes');
    assert.equal((await stat(source)).mode & 0o222, 0);
    assert.notEqual((await stat(prepared.spreadsheet)).mode & 0o200, 0);
    assert.equal(await readFile(prepared.spreadsheet, 'utf8'), 'source-bytes');
  } finally {
    await chmod(source, 0o644).catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('normalizes names and preserves the csv extension', () => {
  const target = buildUserSpreadsheetWorkingCopyPath({
    sourcePath: '/tmp/  销售@@ 任务  .csv',
    taskId: TASK_ID,
    createdAt: CREATED_AT
  });

  assert.equal(
    target,
    '/tmp/销售_任务_任务副本_20260629_163015_a1b2c3d4.csv'
  );
});

test('leaves resume-cache spreadsheets unchanged', async () => {
  const options = { ...createOptions('/tmp/AfterEdit.xlsx'), pipelineStage: 'resume-cache' as const };
  const prepared = await prepareUserSpreadsheetWorkingCopy({
    taskId: TASK_ID,
    createdAt: CREATED_AT,
    options
  });

  assert.equal(prepared, options);
});

test('does not overwrite an existing working copy', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'spreadsheet-copy-conflict-'));
  const source = path.join(tempDir, 'tasks.xlsx');
  const target = buildUserSpreadsheetWorkingCopyPath({
    sourcePath: source,
    taskId: TASK_ID,
    createdAt: CREATED_AT
  });
  try {
    await writeFile(source, 'source');
    await writeFile(target, 'existing');

    await assert.rejects(
      prepareUserSpreadsheetWorkingCopy({
        taskId: TASK_ID,
        createdAt: CREATED_AT,
        options: createOptions(source)
      }),
      WorkingCopyNameConflictError
    );
    assert.equal(await readFile(target, 'utf8'), 'existing');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function createOptions(spreadsheet: string) {
  return {
    spreadsheet,
    downloadDir: '/tmp/downloads',
    taxonomy: '/tmp/taxonomy.md',
    promptLibrary: '/tmp/prompts.md',
    archiveRoot: '/tmp/archive'
  };
}
