import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { runLocalPipelineCommand } from '../../../../apps/cli/local-pipeline-command.ts';
import { runTaggingBatch } from '../../../../apps/cli/local-pipeline-tagging.ts';
import { createStageEmitter } from '../../../../apps/cli/local-pipeline-helpers.ts';
import { runArchiveStage } from '../../../../apps/cli/pipeline/stages/archive.ts';
import { buildArchivePlacementPlans } from '../../../features/archive/domain/index.ts';
import {
  parsePromptLibraryMarkdown,
  type ArchivePathPolicy,
  type StructuredTagCandidate,
  type StructuredTaggingResponse
} from '../../../features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';
import { archiveFileByPlans } from '../../../adapters/storage/filesystem/archive-file-operator.ts';
import { readSpreadsheetTaskSheet } from '../../../adapters/spreadsheets/local-spreadsheet.ts';

const xlsx = XLSX.default ?? XLSX;
const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');
const V03_TAXONOMY_PATH = path.join(
  PROJECT_ROOT,
  'config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md'
);
const V03_ARCHIVE_POLICY: ArchivePathPolicy = Object.freeze({
  dimension: '核心动作',
  primaryRole: '主动作',
  requiredCount: 1,
  onInvalid: 'retry-once-then-review'
});

test('local pipeline auto-segments remote downloads before tagging and archiving', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase5-auto-seg-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    writeWorkbook(spreadsheetPath);
    writeSharedFiles({
      downloadFixturesPath,
      candidateFixturesPath
    });

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir,
        taxonomyPreset: 'core-v0.3-drama',
        taxonomy: V03_TAXONOMY_PATH,
        promptLibrary: V03_TAXONOMY_PATH,
        archiveRoot: tempDir,
        downloadFixtures: downloadFixturesPath,
        candidateFixtures: candidateFixturesPath,
        taggingMode: 'simulated',
        timestamp: '2026-05-12T10:00:00.000Z',
        autoSegmentation: true,
        writebackTarget: 'user'
      },
      report: () => undefined,
      segmentationDependencies: {
        mediaInfoReader: {
          async readMediaInfo() {
            return { durationSeconds: 45, width: 1920, height: 1080 };
          }
        },
        boundaryDetector: {
          async detectShots() {
            return [{ startSeconds: 0, endSeconds: 45 }];
          }
        },
        segmentExporter: {
          async exportSegment(input) {
            mkdirSync(path.dirname(input.outputFilePath), { recursive: true });
            writeFileSync(input.outputFilePath, `${input.startSeconds}-${input.endSeconds}`, 'utf8');
            return { outputFilePath: input.outputFilePath };
          }
        }
      }
    });

    const archiveDir = path.join(tempDir, '视频数据归档库/核心动作/身体动作/位移动作/跑动');
    const firstClip = path.join(archiveDir, 'Sample_A_720P_260512_000023_01.mp4');
    const secondClip = path.join(archiveDir, 'Sample_A_720P_260512_000023_02.mp4');
    const sourceArchivePath = path.join(archiveDir, 'Sample_A_720P_260512_000045.mp4');

    assert.equal(result.failures.length, 0);
    assert.equal(existsSync(firstClip), true);
    assert.equal(existsSync(secondClip), true);
    assert.equal(existsSync(sourceArchivePath), false);
    assert.equal(await readFile(firstClip, 'utf8'), '0-22.5');
    assert.equal(await readFile(secondClip, 'utf8'), '22.5-45');

    const postEditWorkbook = xlsx.readFile(path.join(downloadDir, 'AfterEdit', 'AfterEdit_归档记录表.xlsx'));
    const postEditRows = xlsx.utils.sheet_to_json<Record<string, string>>(
      postEditWorkbook.Sheets[postEditWorkbook.SheetNames[0]!],
      { defval: '' }
    );
    assert.deepEqual(postEditRows.map((row) => row.文件名), [
      'Sample_A_720P_260512_000023_01.mp4',
      'Sample_A_720P_260512_000023_02.mp4'
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V0.3 archives by the unique main action and preserves secondary and unrelated tags', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase5-main-action-'));
  const mediaPath = path.join(tempDir, 'sample.mp4');
  const resultsByRow = new Map();
  const failures: Array<{ readonly errorCode: string }> = [];
  const mainAction = tag('核心动作', '主动作', ['核心动作', '身体动作', '位移动作', '跑动']);
  const secondaryAction = tag('核心动作', '次动作', ['核心动作', '身体动作', '姿态动作', '手势表达']);
  const contentTag = tag('内容领域', '主领域', ['内容领域', '人物生活', '日常生活']);

  try {
    writeFileSync(mediaPath, 'video');
    const taxonomyMarkdown = await readFile(V03_TAXONOMY_PATH, 'utf8');
    const structuredResponse = response([mainAction, secondaryAction, contentTag]);
    const modelJson = rawResponse([mainAction, secondaryAction, contentTag]);
    await runTaggingBatch({
      assets: [asset(mediaPath)],
      rowByTaskId: rowMap(), resultsByRow, failures,
      startedAt: '2026-06-29T00:00:00.000Z', taggingMode: 'qwen',
      taxonomyTree: parseTaxonomyMarkdown(taxonomyMarkdown, { rootMode: 'bullet-root' }),
      promptLibrary: parsePromptLibraryMarkdown(taxonomyMarkdown),
      archivePathPolicy: V03_ARCHIVE_POLICY,
      generateModelCandidates: async () => ({
        candidatePaths: structuredResponse.tags.map((item) => item.labelPath.join(' > ')),
        rawText: '', promptInstruction: '', structuredResponse, parsedJson: modelJson
      }),
      emit: () => undefined
    });

    const row = resultsByRow.get(2);
    assert.equal(failures.length, 0);
    assert.equal(row?.archivePath, '视频数据归档库/核心动作/身体动作/位移动作/跑动');
    const archived = await archiveFileByPlans({
      sourceFilePath: mediaPath,
      archiveRoot: path.join(tempDir, '视频数据归档库'),
      placementPlans: buildArchivePlacementPlans({
        acceptedPaths: [row.selectedContentTopicPath], fileName: 'sample.mp4'
      }),
      placementMode: 'copy', taskId: 'task-1', mediaAssetId: 'asset-1',
      taxonomyVersionId: 'Core_Base_Prompt_V0.3_Drama_Core_Candidate',
      fingerprintId: 'fingerprint-1', recordedAt: '2026-06-29T00:00:00.000Z',
      jsonSidecarContent: `${JSON.stringify(row.taggingJsonPayload, null, 2)}\n`
    });
    assert.equal(archived[0]?.archivePath, '核心动作/身体动作/位移动作/跑动/sample.mp4');
    const sidecar = JSON.parse(await readFile(path.join(tempDir, '视频数据归档库/核心动作/身体动作/位移动作/跑动/sample.json'), 'utf8'));
    assert.equal(sidecar.tags.some((item: { tag_role?: string }) => item.tag_role === '次动作'), true);
    assert.equal(sidecar.tags.some((item: { dimension?: string }) => item.dimension === '内容领域'), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V0.3 stops after one failed primary-action repair and keeps the review sidecar', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase5-main-action-failure-'));
  const mediaPath = path.join(tempDir, 'sample.mp4');
  const spreadsheetPath = path.join(tempDir, 'failed-review.xlsx');
  const archiveRoot = path.join(tempDir, 'archive-output');
  const resultsByRow = new Map();
  const failures: Array<{ readonly errorCode: string }> = [];
  let modelCalls = 0;

  try {
    writeFileSync(mediaPath, 'video');
    const taxonomyMarkdown = await readFile(V03_TAXONOMY_PATH, 'utf8');
    await runTaggingBatch({
      assets: [asset(mediaPath)], rowByTaskId: rowMap(), resultsByRow, failures,
      startedAt: '2026-06-29T00:00:00.000Z', taggingMode: 'qwen',
      taxonomyTree: parseTaxonomyMarkdown(taxonomyMarkdown, { rootMode: 'bullet-root' }),
      promptLibrary: parsePromptLibraryMarkdown(taxonomyMarkdown),
      archivePathPolicy: V03_ARCHIVE_POLICY,
      generateModelCandidates: async () => {
        modelCalls += 1;
        return {
          candidatePaths: [], rawText: '', promptInstruction: '',
          structuredResponse: response([]),
          parsedJson: { review_required: true, review_reason: '核心动作主动作无法确定', tags: [], attempt: modelCalls }
        };
      },
      emit: () => undefined
    });

    const row = resultsByRow.get(2);
    assert.equal(modelCalls, 2);
    assert.equal(failures[0]?.errorCode, 'archive-primary-tag-missing');
    assert.equal(row?.archivePath, '');
    assert.equal(row?.archiveFileName, '');
    assert.equal(row?.taggingJsonArchivePath, '');
    assert.equal(row?.archiveState, '待复核：核心动作主动作缺失');

    writeFailedReviewWorkbook(spreadsheetPath, mediaPath);
    await runArchiveStage({
      input: {
        options: {
          spreadsheet: spreadsheetPath,
          downloadDir: tempDir,
          taxonomy: V03_TAXONOMY_PATH,
          promptLibrary: V03_TAXONOMY_PATH,
          archiveRoot,
          writebackTarget: 'user'
        }
      },
      sheet: readSpreadsheetTaskSheet({ filePath: spreadsheetPath }),
      emit: createStageEmitter(() => undefined),
      startedAt: '2026-06-29T00:00:00.000Z',
      resultsByRow,
      failures
    });

    const resultAfterArchive = resultsByRow.get(2);
    assert.equal(resultAfterArchive, row);
    assert.equal(resultAfterArchive?.archiveState, '待复核：核心动作主动作缺失');
    assert.equal(resultAfterArchive?.archivePath, '');
    assert.equal(resultAfterArchive?.archiveFileName, '');
    assert.equal(existsSync(path.join(archiveRoot, '视频数据归档库')), false);

    const diskSidecar = JSON.parse(await readFile(path.join(tempDir, 'sample.json'), 'utf8'));
    assert.equal(diskSidecar.review_required, true);
    assert.match(diskSidecar.review_reason, /核心动作/u);
    assert.equal(diskSidecar.attempt, 2);
    assert.deepEqual(diskSidecar.tags, []);
    assert.deepEqual(resultAfterArchive?.taggingJsonPayload, diskSidecar);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeWorkbook(filePath: string): void {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['URL', '采集人', 'title'],
    ['https://www.youtube.com/watch?v=auto-seg', '测试用户', 'Sample A']
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, filePath);
}

function writeFailedReviewWorkbook(filePath: string, mediaPath: string): void {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet([
    ['URL', '归档状态', '当前文件路径', '归档路径', '归档文件名'],
    [
      'https://example.com/video',
      '等待归档',
      mediaPath,
      '视频数据归档库/核心动作/身体动作/位移动作/跑动',
      ''
    ]
  ]);
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  xlsx.writeFile(workbook, filePath);
}

function writeSharedFiles(input: {
  readonly downloadFixturesPath: string;
  readonly candidateFixturesPath: string;
}): void {
  writeFileSync(
    input.downloadFixturesPath,
    JSON.stringify({
      'https://www.youtube.com/watch?v=auto-seg': {
        mode: 'muxed',
        extension: 'mp4',
        content: 'source-video',
        title: 'Sample A',
        resolutionLabel: '720P',
        durationSeconds: 45
      }
    })
  );
  writeFileSync(
    input.candidateFixturesPath,
    JSON.stringify({
      'https://www.youtube.com/watch?v=auto-seg': [
        '核心动作 > 身体动作 > 位移动作 > 跑动',
        '内容领域 > 人物生活 > 日常生活'
      ],
      'https://youtube.com/watch?v=auto-seg': [
        '核心动作 > 身体动作 > 位移动作 > 跑动',
        '内容领域 > 人物生活 > 日常生活'
      ]
    })
  );
}

function tag(
  dimension: string,
  tagRole: string,
  labelPath: readonly string[]
): StructuredTagCandidate {
  return Object.freeze({
    dimension,
    tagRole,
    labelPath: Object.freeze([...labelPath]),
    selectedLevel: `l${labelPath.length}`,
    entityId: 'entity-1',
    targetEntityId: 'entity-1'
  });
}

function response(tags: readonly StructuredTagCandidate[]): StructuredTaggingResponse {
  return Object.freeze({
    reviewRequired: false,
    reviewReason: '',
    tags: Object.freeze([...tags])
  });
}

function rawResponse(tags: readonly StructuredTagCandidate[]): unknown {
  return {
    review_required: false,
    review_reason: '',
    tags: tags.map((item) => ({
      dimension: item.dimension,
      label_path: item.labelPath,
      selected_level: item.selectedLevel,
      tag_role: item.tagRole,
      entity_id: item.entityId,
      target_entity_id: item.targetEntityId
    }))
  };
}

function asset(mediaPath: string) {
  return {
    mediaAssetId: 'asset-1', taskId: 'task-1', rowNumber: 2,
    sourceUrl: 'https://example.com/video', platform: 'direct' as const,
    filePath: mediaPath, fileName: 'sample.mp4', downloadedAt: '2026-06-29T00:00:00.000Z'
  };
}

function rowMap() {
  return new Map([['task-1', {
    taskId: 'task-1', rowNumber: 2, url: 'https://example.com/video',
    sourceKind: 'url' as const, values: {}
  }]]);
}
