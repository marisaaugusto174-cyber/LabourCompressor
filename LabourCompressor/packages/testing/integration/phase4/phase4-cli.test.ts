import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

const xlsx = XLSX.default ?? XLSX;
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const CLI_PATH = path.join(PROJECT_ROOT, 'apps/cli/main.ts');

test('runs cli local pipeline and prints stage status', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['url', 'title'],
      ['https://www.youtube.com/watch?v=abc', 'Sample A']
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
        'https://www.youtube.com/watch?v=abc': {
          mode: 'muxed',
          extension: 'mp4',
          content: 'muxed-a',
          title: 'Sample A',
          resolutionLabel: '720P',
          durationSeconds: 27
        }
      })
    );
    writeFileSync(
      candidateFixturesPath,
      JSON.stringify({
        'https://www.youtube.com/watch?v=abc': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        '--download-fixtures',
        downloadFixturesPath,
        '--candidate-fixtures',
        candidateFixturesPath,
        '--timestamp',
        '2026-04-24T19:20:00.000Z'
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);
    assert.equal(
      result.stdout.includes('[SUCCEEDED] archive: Archive processing completed'),
      true
    );
    assert.equal(
      await readFile(
        path.join(
          tempDir,
          '视频数据归档库/内容题材/广告营销/产品广告/Sample_A_720P_260424_000027.mp4'
        ),
        'utf8'
      ),
      'muxed-a'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('skips rows already marked archived or download-satisfied', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人', '归档状态'],
      ['https://www.youtube.com/watch?v=archived', 'A', '已归档'],
      ['https://www.youtube.com/watch?v=downloaded', 'B', '已下载未归档'],
      ['https://www.youtube.com/watch?v=waiting-edit', 'B', '已下载待剪辑'],
      ['https://www.youtube.com/watch?v=too-short', 'B', '已跳过：视频过短'],
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
    writeFileSync(
      candidateFixturesPath,
      JSON.stringify({
        'https://www.youtube.com/watch?v=pending': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        '--download-fixtures',
        downloadFixturesPath,
        '--candidate-fixtures',
        candidateFixturesPath,
        '--timestamp',
        '2026-04-24T19:20:00.000Z'
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);
    assert.equal(
      result.stdout.includes('pending 1, skipped 4 completed row(s)'),
      true
    );
    assert.equal(
      await readFile(
        path.join(
          tempDir,
          '视频数据归档库/内容题材/广告营销/产品广告/Sample_A_720P_260424_000027.mp4'
        ),
        'utf8'
      ),
      'muxed-a'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('stops after download when manual edit gate is enabled and prepares AfterEdit directory', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
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
    writeFileSync(
      candidateFixturesPath,
      JSON.stringify({
        'https://www.youtube.com/watch?v=pending': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        '--download-fixtures',
        downloadFixturesPath,
        '--candidate-fixtures',
        candidateFixturesPath,
        '--timestamp',
        '2026-04-24T19:20:00.000Z',
        '--manual-edit-gate',
        'true'
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Manual edit gate enabled'), true);
    assert.equal(
      await readFile(path.join(downloadDir, 'Sample_A_720P_260424_000027.mp4'), 'utf8'),
      'muxed-a'
    );
    assert.equal(
      spawnSync('test', ['-d', path.join(downloadDir, 'AfterEdit')]).status,
      0
    );
    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '已下载待剪辑');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('reports download failures before stopping at manual edit gate', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-manual-failure-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人', '归档状态', '失败信息'],
      ['https://www.youtube.com/watch?v=ok', 'C', '', ''],
      ['https://www.youtube.com/watch?v=missing', 'C', '', '']
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
        'https://www.youtube.com/watch?v=ok': {
          mode: 'muxed',
          extension: 'mp4',
          content: 'muxed-a',
          title: 'Sample A',
          resolutionLabel: '720P',
          durationSeconds: 27
        }
      })
    );
    writeFileSync(
      candidateFixturesPath,
      JSON.stringify({
        'https://www.youtube.com/watch?v=ok': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        '--download-fixtures',
        downloadFixturesPath,
        '--candidate-fixtures',
        candidateFixturesPath,
        '--timestamp',
        '2026-04-24T19:20:00.000Z',
        '--manual-edit-gate',
        'true'
      ],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '已下载待剪辑');
    assert.equal(updatedSheet[1]?.归档状态, '下载失败');
    assert.equal(
      updatedSheet[1]?.失败信息.includes('No simulated download fixture for URL'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('continues from AfterEdit spreadsheet without running download again', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-afteredit-'));
  const spreadsheetPath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const afterEditDir = path.join(downloadDir, 'AfterEdit');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径', '归档文件名', '失败信息'],
      ['样本A_720P_260427_000010.mp4', '', '', '', '', '', '', '', '']
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
      candidateFixturesPath,
      JSON.stringify({
        '样本A_720P_260427_000010.mp4': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    rmSync(downloadDir, { recursive: true, force: true });
    mkdirSync(afterEditDir, { recursive: true });
    writeFileSync(path.join(afterEditDir, '样本A_720P_260427_000010.mp4'), 'edited-a');

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Downloaded 1 media assets'), true);
    assert.equal(
      await readFile(
        path.join(
          tempDir,
          '视频数据归档库/内容题材/广告营销/产品广告/样本A_720P_260427_000010.mp4'
        ),
        'utf8'
      ),
      'edited-a'
    );
    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '已归档');
    assert.equal(updatedSheet[0]?.一级标签, '内容题材: 广告营销');
    assert.equal(updatedSheet[0]?.归档文件名, '样本A_720P_260427_000010.mp4');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('continues from nested AfterEdit relative paths without source url mapping', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-afteredit-relative-'));
  const spreadsheetPath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const afterEditDir = path.join(downloadDir, 'AfterEdit');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '原始文件名', '来源URL', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径', '归档文件名', '失败信息'],
      ['样本A_720P_260427_000010.mp4', 'clips/样本A_720P_260427_000010.mp4', 'export-a.mp4', '', '', '', '', '', '', '', '', '']
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
      candidateFixturesPath,
      JSON.stringify({
        '样本A_720P_260427_000010.mp4': ['内容题材 > 广告营销 > 产品广告']
      })
    );

    rmSync(downloadDir, { recursive: true, force: true });
    mkdirSync(path.join(afterEditDir, 'clips'), { recursive: true });
    writeFileSync(path.join(afterEditDir, 'clips', '样本A_720P_260427_000010.mp4'), 'edited-a');

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr);

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '已归档');
    assert.equal(updatedSheet[0]?.归档文件名, '样本A_720P_260427_000010.mp4');
    assert.equal(
      await readFile(
        path.join(
          tempDir,
          '视频数据归档库/内容题材/广告营销/产品广告/样本A_720P_260427_000010.mp4'
        ),
        'utf8'
      ),
      'edited-a'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('records tagging failures for AfterEdit rows without crashing the task', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-afteredit-tagging-failure-'));
  const spreadsheetPath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const afterEditDir = path.join(downloadDir, 'AfterEdit');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '原始文件名', '来源URL', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径', '归档文件名', '失败信息'],
      ['样本A_720P_260427_000010.mp4', 'clips/样本A_720P_260427_000010.mp4', 'export-a.mp4', '', '', '', '', '', '', '', '', '']
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

    rmSync(downloadDir, { recursive: true, force: true });
    mkdirSync(path.join(afterEditDir, 'clips'), { recursive: true });
    writeFileSync(path.join(afterEditDir, 'clips', '样本A_720P_260427_000010.mp4'), 'edited-a');

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes('buildFailure is not defined'), false);

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '打标失败');
    assert.equal(
      updatedSheet[0]?.失败信息.includes('Missing candidate fixture for source URL'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('blocks AfterEdit second stage when edited file name does not match naming rule', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase4-afteredit-invalid-'));
  const spreadsheetPath = path.join(tempDir, 'AfterEdit_归档记录表.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const afterEditDir = path.join(downloadDir, 'AfterEdit');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '归档状态', '一级标签', '二级标签', '三级标签', '四级标签', '归档路径', '归档文件名', '失败信息'],
      ['bad file name.mp4', '', '', '', '', '', '', '', '']
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

    rmSync(downloadDir, { recursive: true, force: true });
    mkdirSync(afterEditDir, { recursive: true });
    writeFileSync(path.join(afterEditDir, 'bad file name.mp4'), 'edited-a');

    const result = spawnSync(
      'node',
      [
        CLI_PATH,
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
        cwd: PROJECT_ROOT,
        encoding: 'utf8'
      }
    );

    assert.equal(result.status, 0);

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets[updatedWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.equal(updatedSheet[0]?.归档状态, '文件名不合法');
    assert.equal(
      updatedSheet[0]?.失败信息.includes('Edited file name does not match naming rule'),
      true
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
