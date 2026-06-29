import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { runLocalPipelineCommand } from '../../../../apps/cli/local-pipeline-command.ts';
import { shouldSkipArchiveRow } from '../../../../apps/cli/pipeline/stages/archive.ts';
import {
  resolveSelectedArchivePath,
  resolveSelectedContentTopicPath,
  shouldProcessMediaRow
} from '../../../../apps/cli/pipeline/row-state.ts';
import { type SpreadsheetTaskRow } from '../../../../packages/features/spreadsheet-tasks/domain/index.ts';

const xlsx = XLSX.default ?? XLSX;

test('segment stage accepts local URL-column files and appends clip rows', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-v04-segment-'));
  const mediaPath = path.join(tempDir, 'commercial_1080P_260515_000012.mp4');
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');

  try {
    writeFileSync(mediaPath, 'fake video');
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人'],
      [mediaPath, '测试用户']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'runtime'),
        taxonomy: path.join(tempDir, 'taxonomy.md'),
        promptLibrary: path.join(tempDir, 'prompt.md'),
        archiveRoot: path.join(tempDir, 'archive'),
        writebackTarget: 'user',
        pipelineStage: 'segment',
        segmentationProfileId: 'standard_ad'
      },
      report: () => undefined,
      segmentationDependencies: {
        mediaInfoReader: {
          async readMediaInfo() {
            return {
              durationSeconds: 12,
              width: 1920,
              height: 1080,
              frameRate: 24,
              codecName: 'h264',
              hasAudio: true
            };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [
              { startSeconds: 0, endSeconds: 6, confidence: 0.9 },
              { startSeconds: 6, endSeconds: 12, confidence: 0.9 }
            ];
          }
        },
        continuityAnalyzer: {
          async analyzeBoundaries() {
            return [createBoundaryDecision(6, 'strong-boundary')];
          }
        },
        segmentExporter: {
          async exportSegment(input) {
            await mkdir(path.dirname(input.outputFilePath), { recursive: true });
            await writeFile(input.outputFilePath, 'clip');
            return { outputFilePath: input.outputFilePath };
          }
        }
      }
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.failedRows, 0);
    assert.equal(records.length, 3);
    assert.equal(records[0]?.归档状态, '已分割');
    assert.equal(records[1]?.归档状态, '待压缩');
    assert.equal(records[1]?.源行号, '2');
    assert.equal(records[1]?.片段序号, '1');
    assert.equal(records[2]?.片段序号, '2');
    assert.equal(String(records[1]?.当前文件路径 ?? '').endsWith('_01.mp4'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('download stage processes network url rows and writes current file path', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-v04-download-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const fixturesPath = path.join(tempDir, 'download-fixtures.json');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人'],
      ['https://www.youtube.com/watch?v=v04-download', '测试用户']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);
    writeFileSync(fixturesPath, JSON.stringify({
      'https://www.youtube.com/watch?v=v04-download': {
        mode: 'muxed',
        extension: 'mp4',
        content: 'source-video',
        title: 'Download Sample',
        resolutionLabel: '720P',
        durationSeconds: 12
      }
    }));

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'runtime'),
        taxonomy: path.join(tempDir, 'taxonomy.md'),
        promptLibrary: path.join(tempDir, 'prompt.md'),
        archiveRoot: path.join(tempDir, 'archive'),
        writebackTarget: 'user',
        pipelineStage: 'download',
        downloaderMode: 'simulated',
        mergeMode: 'local',
        downloadFixtures: fixturesPath
      },
      report: () => undefined
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.failedRows, 0);
    assert.equal(records[0]?.归档状态, '已下载');
    assert.equal(String(records[0]?.当前文件路径 ?? '').endsWith('.mp4'), true);
    assert.equal(records[0]?.源文件路径, records[0]?.当前文件路径);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('compress stage resolves AfterEdit relative paths when current path columns are empty', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-v04-compress-afteredit-'));
  const afterEditDirectory = path.join(tempDir, 'AfterEdit');
  const mediaPath = path.join(afterEditDirectory, 'clips', '样本A_720P_260427_000001.mp4');
  const spreadsheetPath = path.join(afterEditDirectory, 'AfterEdit_归档记录表.xlsx');

  try {
    await mkdir(path.dirname(mediaPath), { recursive: true });
    writeTinyVideo(mediaPath);

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '原始文件名', '来源URL', '归档状态', '源文件路径', '当前文件路径', '压缩缓存路径'],
      ['样本A_720P_260427_000001.mp4', 'clips/样本A_720P_260427_000001.mp4', 'export-a.mp4', '', '待压缩', '', '', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'runtime'),
        taxonomy: path.join(tempDir, 'taxonomy.md'),
        promptLibrary: path.join(tempDir, 'prompt.md'),
        archiveRoot: path.join(tempDir, 'archive'),
        writebackTarget: 'user',
        pipelineStage: 'compress'
      },
      report: () => undefined
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.failedRows, 0);
    assert.equal(records[0]?.归档状态, '已压缩');
    assert.equal(records[0]?.源文件路径, mediaPath);
    assert.equal(records[0]?.当前文件路径, mediaPath);
    assert.equal(String(records[0]?.压缩缓存路径 ?? '').endsWith('tagging-360p-a64.mp4'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('all staged pipeline switches to AfterEdit sheet after segmentation', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-v04-all-afteredit-'));
  const mediaPath = path.join(tempDir, 'source_720P_260612_000006.mp4');
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'runtime');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');
  const archiveRoot = path.join(tempDir, 'archive-root');
  const clipOne = 'source_720P_260612_000006_01.mp4';

  try {
    await mkdir(tempDir, { recursive: true });
    writeTinyVideo(mediaPath);
    writeFileSync(
      taxonomyPath,
      '- 内容领域\n  - 商业营销\n    - 产品广告\n'
    );
    writeFileSync(promptLibraryPath, '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n');
    writeFileSync(candidateFixturesPath, JSON.stringify({
      [clipOne]: ['内容领域 > 商业营销 > 产品广告']
    }));

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', '采集人'],
      [mediaPath, '测试用户']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir,
        taxonomy: taxonomyPath,
        taxonomyPreset: 'core-v0.1',
        promptLibrary: promptLibraryPath,
        archiveRoot,
        writebackTarget: 'user',
        pipelineStage: 'all',
        taggingMode: 'simulated',
        candidateFixtures: candidateFixturesPath,
        segmentationProfileId: 'standard_ad'
      },
      report: () => undefined,
      segmentationDependencies: {
        mediaInfoReader: {
          async readMediaInfo() {
            return {
              durationSeconds: 6,
              width: 1280,
              height: 720,
              frameRate: 24,
              codecName: 'h264',
              hasAudio: true
            };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [
              { startSeconds: 0, endSeconds: 3, confidence: 0.9 },
              { startSeconds: 3, endSeconds: 6, confidence: 0.9 }
            ];
          }
        },
        continuityAnalyzer: {
          async analyzeBoundaries() {
            return [createBoundaryDecision(3, 'strong-boundary')];
          }
        },
        segmentExporter: {
          async exportSegment(input) {
            await mkdir(path.dirname(input.outputFilePath), { recursive: true });
            await copyFile(input.inputFilePath, input.outputFilePath);
            return { outputFilePath: input.outputFilePath };
          }
        }
      }
    });

    const postEditPath = path.join(downloadDir, 'AfterEdit', 'AfterEdit_归档记录表.xlsx');
    const updatedWorkbook = xlsx.readFile(postEditPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.failedRows, 0);
    assert.equal(records.length, 1);
    assert.equal(records.every((record) => record.归档状态 === '已归档'), true);
    assert.equal(records.every((record) => record.一级标签 === '内容领域: 商业营销'), true);
    assert.equal(records.every((record) => String(record.压缩缓存路径 ?? '').length > 0), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resume-cache pipeline runs compress, tag, and archive from an AfterEdit sheet', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-resume-cache-'));
  const afterEditDirectory = path.join(tempDir, 'AfterEdit');
  const mediaPath = path.join(afterEditDirectory, 'clips', '样本A_720P_260614_000001_01.mp4');
  const spreadsheetPath = path.join(afterEditDirectory, 'AfterEdit_归档记录表.xlsx');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt.md');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');
  const archiveRoot = path.join(tempDir, 'archive-root');

  try {
    await mkdir(path.dirname(mediaPath), { recursive: true });
    writeTinyVideo(mediaPath);
    writeFileSync(
      taxonomyPath,
      '- 内容领域\n  - 商业营销\n    - 产品广告\n'
    );
    writeFileSync(promptLibraryPath, '# 标注提示词库\n\n## 规则\n- 只能输出标签库中的标签\n');
    writeFileSync(candidateFixturesPath, JSON.stringify({
      '样本A_720P_260614_000001_01.mp4': ['内容领域 > 商业营销 > 产品广告']
    }));

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['文件名', '相对路径', '原始文件名', '来源URL', '归档状态', '源文件路径', '当前文件路径', '压缩缓存路径'],
      ['样本A_720P_260614_000001_01.mp4', 'clips/样本A_720P_260614_000001_01.mp4', 'source.mp4', '', '待压缩', '', '', '']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir: path.join(tempDir, 'runtime'),
        taxonomy: taxonomyPath,
        taxonomyPreset: 'core-v0.1',
        promptLibrary: promptLibraryPath,
        archiveRoot,
        writebackTarget: 'user',
        pipelineStage: 'resume-cache',
        taggingMode: 'simulated',
        candidateFixtures: candidateFixturesPath
      },
      report: () => undefined
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      updatedWorkbook.Sheets.Sheet1,
      { defval: '' }
    );

    assert.equal(result.failedRows, 0);
    assert.equal(records[0]?.归档状态, '已归档');
    assert.equal(String(records[0]?.压缩缓存路径 ?? '').endsWith('tagging-360p-a64.mp4'), true);
    assert.equal(records[0]?.一级标签, '内容领域: 商业营销');
    assert.equal(records[0]?.归档路径, '视频数据归档库/内容领域/商业营销/产品广告');
    await access(path.join(
      archiveRoot,
      '视频数据归档库',
      '内容领域',
      '商业营销',
      '产品广告',
      '样本A_720P_260614_000001_01.mp4'
    ));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('archive path resolver accepts generic rooted and legacy relative paths', () => {
  const cases = [
    {
      archivePath: '视频数据归档库/核心动作/身体动作/位移动作/跑动',
      expected: '核心动作 > 身体动作 > 位移动作 > 跑动'
    },
    {
      archivePath: '视频数据归档库/内容领域/商业营销/产品广告',
      expected: '内容领域 > 商业营销 > 产品广告'
    },
    {
      archivePath: '内容题材/生活方式/日常记录',
      expected: '内容题材 > 生活方式 > 日常记录'
    }
  ] as const;

  for (const { archivePath, expected } of cases) {
    assert.equal(resolveSelectedArchivePath(createArchiveRow(archivePath)), expected);
  }
});

test('archive path resolver leaves empty and root-only paths waiting for tagging', () => {
  assert.equal(resolveSelectedArchivePath(createArchiveRow('')), undefined);
  assert.equal(resolveSelectedArchivePath(createArchiveRow('视频数据归档库')), undefined);
  assert.equal(resolveSelectedArchivePath(createArchiveRow('视频数据归档库/核心动作')), undefined);
});

test('archive stage row filter leaves archived rows unchanged', () => {
  assert.equal(shouldProcessMediaRow(createArchiveRow('', '已归档')), false);
});

test('archive stage preserves classified failures and persisted review rows', () => {
  assert.equal(shouldSkipArchiveRow(
    createArchiveRow('', '等待归档'),
    { failure: { errorCode: 'archive-primary-tag-missing' } }
  ), true);
  assert.equal(shouldSkipArchiveRow(
    createArchiveRow('', '待复核：核心动作主动作缺失'),
    undefined
  ), true);
  assert.equal(shouldSkipArchiveRow(createArchiveRow(''), undefined), false);
});

test('legacy content topic resolver remains an alias of the generic resolver', () => {
  assert.equal(resolveSelectedContentTopicPath, resolveSelectedArchivePath);
});

function createArchiveRow(archivePath: string, archiveState = '等待归档'): SpreadsheetTaskRow {
  return {
    taskId: 'task-archive-path',
    rowNumber: 2,
    url: '',
    sourceKind: 'local-file',
    values: {
      归档路径: archivePath,
      归档状态: archiveState
    }
  };
}

function writeTinyVideo(filePath: string): void {
  const result = spawnSync(
    'ffmpeg',
    [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:d=1',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      filePath
    ],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || 'ffmpeg failed to create test video.');
  }
}

function createBoundaryDecision(
  boundarySeconds: number,
  classification: 'strong-continuity' | 'strong-boundary' | 'weak-or-unknown'
) {
  return {
    boundarySeconds,
    visual: { verdict: 'unknown' as const, metrics: { histogramSimilarity: 0.7, normalizedFrameDifference: 0.25 } },
    motion: { verdict: 'unknown' as const, metrics: { beforeMagnitude: 1, afterMagnitude: 1, directionCosine: 0, magnitudeRatio: 1 } },
    audio: { verdict: 'unknown' as const, metrics: { available: false as const } },
    classification
  };
}
