import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

const xlsx = XLSX.default ?? XLSX;

test('blocks AfterEdit second stage when spreadsheet rows cannot map current AfterEdit batch', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-afteredit-unmapped-'));
  const spreadsheetPath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const afterEditDir = path.join(downloadDir, 'AfterEdit');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    writeAfterEditSpreadsheet(spreadsheetPath);
    writeSharedFixtures({ taxonomyPath, promptLibraryPath, candidateFixturesPath });

    rmSync(downloadDir, { recursive: true, force: true });
    mkdirSync(afterEditDir, { recursive: true });
    writeFileSync(path.join(afterEditDir, '样本A_720P_260427_000010.mp4'), 'edited-a');

    const result = spawnSync(
      'node',
      [
        '/Users/tianyi/Desktop/codex/jobtask/apps/cli/main.ts',
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
        '--tagging-mode',
        'simulated',
        '--timestamp',
        '2026-04-24T19:20:00.000Z'
      ],
      {
        cwd: '/Users/tianyi/Desktop/codex/jobtask',
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.includes('AfterEdit 文件校验未通过，已阻断进入打标阶段'), true);
    assert.equal(result.stdout.includes('Running automatic tagging'), false);
    assert.equal(
      spawnSync('test', [
        '!',
        '-e',
        path.join(
          tempDir,
          '视频数据归档库/内容题材/广告营销/产品广告/样本A_720P_260427_000010.mp4'
        )
      ]).status,
      0
    );

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '');
    assert.equal(updatedSheet[1]?.归档状态, '文件缺失');
    assert.equal(
      updatedSheet[1]?.失败信息.includes('Edited file not found in AfterEdit'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeAfterEditSpreadsheet(filePath: string): void {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['文件名', '相对路径', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径', '归档文件名', '失败信息'],
    ['样本A_720P_260427_000010.mp4', '样本A_720P_260427_000010.mp4', '', '', '', '', '', '', '', ''],
    ['样本B_720P_260427_000010.mp4', '样本B_720P_260427_000010.mp4', '', '', '', '', '', '', '', '']
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, filePath);
}

function writeSharedFixtures(input: {
  readonly taxonomyPath: string;
  readonly promptLibraryPath: string;
  readonly candidateFixturesPath: string;
}): void {
  writeFileSync(
    input.taxonomyPath,
    '## 1. 内容题材（末端计数：1）\n\n- 广告营销\n  - 产品广告\n'
  );
  writeFileSync(
    input.promptLibraryPath,
    '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n'
  );
  writeFileSync(
    input.candidateFixturesPath,
    JSON.stringify({
      '样本A_720P_260427_000010.mp4': ['内容题材 > 广告营销 > 产品广告']
    })
  );
}
