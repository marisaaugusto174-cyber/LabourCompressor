import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

const xlsx = XLSX.default ?? XLSX;
const cliPath = '/Users/tianyi/Desktop/codex/jobtask/apps/cli/main.ts';
const cwd = '/Users/tianyi/Desktop/codex/jobtask';

test('reuses existing standardized download artifact on yt-dlp rerun instead of failing', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-ytdlp-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');
  const fakeYtDlpPath = path.join(tempDir, 'fake-yt-dlp.sh');
  const existingFilePath = path.join(
    downloadDir,
    'Sample_A_720P_260424_000027.mp4'
  );

  try {
    mkdirSync(downloadDir, { recursive: true });
    writeFileSync(existingFilePath, 'existing-content', 'utf8');

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人', '归档状态', '失败信息'],
      ['https://www.youtube.com/watch?v=abc', 'A', '', '']
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
    writeFileSync(candidateFixturesPath, JSON.stringify({}));
    writeFileSync(
      fakeYtDlpPath,
      `#!/bin/sh
echo 'LCMETA:Sample A\t720\t27'
echo 'LCFILE:${existingFilePath}'
`,
      'utf8'
    );
    chmodSync(fakeYtDlpPath, 0o755);

    const result = spawnSync(
      'node',
      [
        cliPath,
        'run-local-pipeline',
        '--spreadsheet',
        spreadsheetPath,
        '--download-dir',
        downloadDir,
        '--taxonomy',
        taxonomyPath,
        '--prompt-library',
        promptLibraryPath,
        '--archive-root',
        tempDir,
        '--candidate-fixtures',
        candidateFixturesPath,
        '--downloader-mode',
        'yt-dlp',
        '--yt-dlp-binary',
        fakeYtDlpPath,
        '--timestamp',
        '2026-04-24T19:20:00.000Z',
        '--manual-edit-gate',
        'true'
      ],
      {
        cwd,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Manual edit gate enabled'), true);
    assert.equal(readFileSync(existingFilePath, 'utf8'), 'existing-content');

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '已下载待剪辑');
    assert.equal(updatedSheet[0]?.失败信息, '');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
