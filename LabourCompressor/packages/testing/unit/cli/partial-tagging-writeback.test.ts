import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { writePartialTaggingResultsFromSidecars } from '../../../../apps/cli/partial-tagging-writeback.ts';

const xlsx = XLSX.default ?? XLSX;

test('writes completed sidecar tagging results back before a tag task finishes', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-partial-writeback-'));
  const afterEditDirectory = path.join(tempDir, 'AfterEdit');
  const mediaPath = path.join(afterEditDirectory, '样本A_720P_260610_000004_01.mp4');
  const spreadsheetPath = path.join(afterEditDirectory, 'AfterEdit_归档记录表.xlsx');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptPath = path.join(tempDir, 'prompt.md');

  try {
    mkdirSync(afterEditDirectory, { recursive: true });
    writeFileSync(mediaPath, 'fake video');
    writeFileSync(
      mediaPath.replace(/\.mp4$/u, '.json'),
      `${JSON.stringify({
        taxonomy_version: 'Core_Prompt_V0.1',
        tags: [
          {
            dimension: '内容领域',
            label_path: ['内容领域', '商业营销', '产品广告']
          },
          {
            dimension: '表现形式',
            label_path: ['表现形式', '商业传播']
          }
        ]
      }, null, 2)}\n`
    );
    writeFileSync(
      taxonomyPath,
      [
        '- 内容领域',
        '  - 商业营销',
        '    - 产品广告',
        '- 表现形式',
        '  - 商业传播',
        ''
      ].join('\n')
    );
    writeFileSync(promptPath, '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n');

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '归档状态', '源文件路径', '当前文件路径', '压缩缓存路径'],
      ['样本A_720P_260610_000004_01.mp4', '样本A_720P_260610_000004_01.mp4', '已压缩', mediaPath, mediaPath, path.join(tempDir, 'cache.mp4')]
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await writePartialTaggingResultsFromSidecars({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'downloads'),
        taxonomy: taxonomyPath,
        taxonomyPreset: 'core-v0.1',
        promptLibrary: promptPath,
        archiveRoot: tempDir,
        writebackTarget: 'user'
      },
      startedAt: '2026-06-10T10:00:00.000Z'
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.updatedRows, 1);
    assert.equal(result.matchedJsonFiles, 1);
    assert.equal(records[0]?.归档状态, '待归档');
    assert.equal(records[0]?.一级标签, '内容领域: 商业营销 | 表现形式: 商业传播');
    assert.equal(records[0]?.二级标签, '内容领域: 产品广告');
    assert.equal(records[0]?.归档路径, '视频数据归档库/内容领域/商业营销/产品广告');
    assert.equal(records[0]?.标签JSON文件, '样本A_720P_260610_000004_01.json');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uses task event content topic when sidecar json required fallback tagging', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-partial-writeback-fallback-'));
  const afterEditDirectory = path.join(tempDir, 'AfterEdit');
  const mediaPath = path.join(afterEditDirectory, '样本B_720P_260610_000004_01.mp4');
  const spreadsheetPath = path.join(afterEditDirectory, 'AfterEdit_归档记录表.xlsx');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptPath = path.join(tempDir, 'prompt.md');

  try {
    mkdirSync(afterEditDirectory, { recursive: true });
    writeFileSync(mediaPath, 'fake video');
    writeFileSync(
      mediaPath.replace(/\.mp4$/u, '.json'),
      `${JSON.stringify({
        taxonomy_version: 'Core_Prompt_V0.1',
        tags: [
          {
            dimension: '表现形式',
            label_path: ['表现形式', '商业传播']
          }
        ]
      }, null, 2)}\n`
    );
    writeFileSync(
      taxonomyPath,
      [
        '- 内容领域',
        '  - 娱乐文化',
        '    - 娱乐领域',
        '      - 游戏电竞',
        '- 表现形式',
        '  - 商业传播',
        ''
      ].join('\n')
    );
    writeFileSync(promptPath, '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n');

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '归档状态', '源文件路径', '当前文件路径'],
      ['样本B_720P_260610_000004_01.mp4', '样本B_720P_260610_000004_01.mp4', '已压缩', mediaPath, mediaPath]
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await writePartialTaggingResultsFromSidecars({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'downloads'),
        taxonomy: taxonomyPath,
        taxonomyPreset: 'core-v0.1',
        promptLibrary: promptPath,
        archiveRoot: tempDir,
        writebackTarget: 'user'
      },
      selectedContentTopicByFileName: {
        '样本B_720P_260610_000004_01.mp4': '内容领域 > 娱乐文化 > 娱乐领域 > 游戏电竞'
      },
      startedAt: '2026-06-10T10:00:00.000Z'
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.updatedRows, 1);
    assert.equal(result.failedRows, 0);
    assert.equal(records[0]?.归档状态, '待归档');
    assert.equal(records[0]?.三级标签, '内容领域: 游戏电竞');
    assert.equal(records[0]?.归档路径, '视频数据归档库/内容领域/娱乐文化/娱乐领域/游戏电竞');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
