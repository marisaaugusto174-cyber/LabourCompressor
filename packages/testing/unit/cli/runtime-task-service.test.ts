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

async function waitForTask(
  service: ReturnType<typeof createRuntimeTaskService>,
  taskId: string
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const task = service.getTask(taskId);
    if (task !== undefined && task.status !== 'queued' && task.status !== 'running') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for task ${taskId}.`);
}
