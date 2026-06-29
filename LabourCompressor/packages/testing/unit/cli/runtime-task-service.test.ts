import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { createRuntimeTaskService } from '../../../../apps/web/task-service.ts';

const xlsx = XLSX.default ?? XLSX;

test('persists completed runtime tasks and restores them after service restart', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-task-service-'));
  const stateFilePath = path.join(tempDir, '.runtime-state', 'tasks.json');
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    mkdirSync(tempDir, { recursive: true });
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人', '归档状态'],
      ['https://www.youtube.com/watch?v=pending', 'C', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    writeFileSync(
      taxonomyPath,
      '## 1. 内容题材（末端计数：1）\n\n- 广告营销\n  - 产品广告\n'
    );
    writeFileSync(
      promptLibraryPath,
      '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n'
    );
    writeFileSync(
      downloadFixturesPath,
      JSON.stringify({
        'https://www.youtube.com/watch?v=pending': {
          mode: 'muxed',
          extension: 'mp4',
          content: 'muxed-a',
          title: 'Sample A',
          resolutionLabel: '720P',
          durationSeconds: 27
        }
      })
    );
    writeFileSync(candidateFixturesPath, JSON.stringify({}));

    const service = createRuntimeTaskService({ stateFilePath });
    const task = await service.startTask({
      spreadsheet: spreadsheetPath,
      downloadDir,
      taxonomy: taxonomyPath,
      promptLibrary: promptLibraryPath,
      archiveRoot: tempDir,
      downloadFixtures: downloadFixturesPath,
      candidateFixtures: candidateFixturesPath,
      downloaderMode: 'simulated',
      mergeMode: 'local',
      taggingMode: 'simulated',
      manualEditGate: true,
      afterEditDirectoryName: 'AfterEdit',
      writebackTarget: 'user',
      timestamp: '2026-04-24T19:20:00.000Z'
    });

    const completed = await waitForTask(service, task.id);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.result?.results[0]?.archiveState, '已下载待剪辑');

    const restoredService = createRuntimeTaskService({ stateFilePath });
    const restoredTask = restoredService.getTask(task.id);
    assert.equal(restoredTask?.status, 'succeeded');
    assert.equal(restoredTask?.result?.results[0]?.archiveState, '已下载待剪辑');
    assert.equal(restoredService.listTasks().length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('prepares options before a runtime task is created', async () => {
  let runnerPath = '';
  const service = createRuntimeTaskService({
    createId: () => 'a1b2c3d4-0000-0000-0000-000000000000',
    now: () => '2026-06-29T08:30:15.000Z',
    prepareOptions: async ({ taskId, createdAt, options }) => {
      assert.equal(taskId.slice(0, 8), 'a1b2c3d4');
      assert.equal(createdAt, '2026-06-29T08:30:15.000Z');
      return { ...options, spreadsheet: '/tmp/tasks-copy.xlsx' };
    },
    pipelineRunner: async ({ options }) => {
      runnerPath = options.spreadsheet;
      return createEmptyPipelineResult('prepared');
    }
  });

  const task = await service.startTask(createMinimalPipelineOptions());
  await waitForTask(service, task.id);

  assert.equal(task.options.spreadsheet, '/tmp/tasks-copy.xlsx');
  assert.equal(runnerPath, '/tmp/tasks-copy.xlsx');
});

test('does not create a task when option preparation fails', async () => {
  let runnerCalled = false;
  const service = createRuntimeTaskService({
    prepareOptions: async () => {
      throw new Error('working copy failed');
    },
    pipelineRunner: async () => {
      runnerCalled = true;
      return createEmptyPipelineResult('must-not-run');
    }
  });

  await assert.rejects(
    service.startTask(createMinimalPipelineOptions()),
    /working copy failed/u
  );
  assert.equal(runnerCalled, false);
  assert.deepEqual(service.listTasks(), []);
});

test('pauses running runtime tasks at the next cooperative checkpoint and resumes them', async () => {
  const service = createRuntimeTaskService({
    pipelineRunner: async ({ control }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await control.waitIfPaused();
      return createEmptyPipelineResult('paused-workflow');
    }
  });

  const task = await service.startTask(createMinimalPipelineOptions());
  const pausingTask = service.pauseTask(task.id);
  assert.equal(pausingTask?.status, 'pausing');

  const pausedTask = await waitForTaskStatus(service, task.id, 'paused');
  assert.equal(pausedTask.status, 'paused');

  const resumedTask = service.resumeTask(task.id);
  assert.equal(resumedTask?.status, 'running');

  const completedTask = await waitForTask(service, task.id);
  assert.equal(completedTask.status, 'succeeded');
});

test('stops running runtime tasks and marks them cancelled', async () => {
  const service = createRuntimeTaskService({
    pipelineRunner: async ({ control }) => {
      await new Promise<void>((resolve, reject) => {
        control.signal.addEventListener('abort', () => reject(control.createAbortError()), {
          once: true
        });
      });
      return createEmptyPipelineResult('cancelled-workflow');
    }
  });

  const task = await service.startTask(createMinimalPipelineOptions());
  const cancellingTask = service.stopTask(task.id);
  assert.equal(cancellingTask?.status, 'cancelling');

  const cancelledTask = await waitForTask(service, task.id);
  assert.equal(cancelledTask.status, 'cancelled');
  assert.equal(cancelledTask.result, undefined);
  assert.match(cancelledTask.error ?? '', /cancelled|取消/iu);
});

async function waitForTask(
  service: ReturnType<typeof createRuntimeTaskService>,
  taskId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = service.getTask(taskId);
    if (task !== undefined && !isActiveTaskStatus(task.status)) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for task ${taskId}.`);
}

function isActiveTaskStatus(status: string): boolean {
  return status === 'queued' ||
    status === 'running' ||
    status === 'pausing' ||
    status === 'paused' ||
    status === 'cancelling';
}

async function waitForTaskStatus(
  service: ReturnType<typeof createRuntimeTaskService>,
  taskId: string,
  status: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = service.getTask(taskId);
    if (task?.status === status) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for task ${taskId} to become ${status}.`);
}

function createMinimalPipelineOptions() {
  return {
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    taxonomy: '/tmp/taxonomy.md',
    promptLibrary: '/tmp/prompts.md',
    archiveRoot: '/tmp/archive'
  };
}

function createEmptyPipelineResult(workflowSessionId: string) {
  return {
    workflowSessionId,
    startedAt: '2026-06-10T00:00:00.000Z',
    completedAt: '2026-06-10T00:00:01.000Z',
    totalRows: 0,
    succeededRows: 0,
    failedRows: 0,
    results: [],
    failures: []
  };
}
