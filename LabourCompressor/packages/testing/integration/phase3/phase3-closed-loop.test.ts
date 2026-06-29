import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { createSimulatedDownloaderAdapter } from '../../../adapters/downloaders/simulated-downloader.ts';
import { mergeDownloadedStreams } from '../../../adapters/media/local-merge-operator.ts';
import {
  buildArchivePlacementPlans,
  createArchiveIndexEntryFromRecords
} from '../../../features/archive/domain/index.ts';
import {
  createSpreadsheetDownloadJobs,
  runSpreadsheetDownloadBatch
} from '../../../features/download/domain/index.ts';
import {
  createDecisionFingerprint,
  createTagResultRecord
} from '../../../core/contracts/index.ts';
import {
  parsePromptLibraryMarkdown,
  runAutomaticTagging
} from '../../../features/tagging/domain/index.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';
import {
  readSpreadsheetTaskSheet,
  writeTagResultsToSpreadsheet
} from '../../../adapters/spreadsheets/local-spreadsheet.ts';
import { archiveFileByPlans } from '../../../adapters/storage/filesystem/archive-file-operator.ts';

const xlsx = XLSX.default ?? XLSX;

test('runs phase 3 closed loop from spreadsheet urls to archive', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase3-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDirectory = path.join(tempDir, 'downloads');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['url', 'title'],
      ['https://www.youtube.com/watch?v=abc', 'Sample A'],
      ['https://www.douyin.com/video/1', 'Sample B']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const sheet = readSpreadsheetTaskSheet({
      filePath: spreadsheetPath,
      urlColumnName: 'url'
    });

    assert.equal(createSpreadsheetDownloadJobs({
      sheet,
      outputDirectory: downloadDirectory
    }).length, 2);

    const downloadBatch = await runSpreadsheetDownloadBatch({
      workflowSessionId: 'workflow-phase3-1',
      sheet,
      outputDirectory: downloadDirectory,
      downloader: createSimulatedDownloaderAdapter({
        fixtures: {
          'https://www.youtube.com/watch?v=abc': {
            mode: 'muxed',
            extension: 'mp4',
            content: 'muxed-a',
            title: 'Sample A',
            resolutionLabel: '720P',
            durationSeconds: 27
          },
          'https://www.douyin.com/video/1': {
            mode: 'separated',
            videoExtension: 'm4v',
            audioExtension: 'm4a',
            videoContent: 'video-b',
            audioContent: 'audio-b',
            title: 'Sample B',
            resolutionLabel: '1080P',
            durationSeconds: 41
          }
        },
        downloadedAt: '2026-04-24T19:00:00.000Z'
      }),
      mergeOperator: {
        mergeStreams: mergeDownloadedStreams
      },
      startedAt: '2026-04-24T18:59:00.000Z'
    });

    const taxonomyTree = parseTaxonomyMarkdown(`
## 1. 主体对象（末端计数：2）

- 人物
  - 年龄

## 2. 内容题材（末端计数：1）

- 广告营销
  - 产品广告
`);
    const promptLibrary = parsePromptLibraryMarkdown(`
# 标注提示词库

## 规则
- 只能输出标签库中的标签
`);

    const assignments = downloadBatch.downloadedAssets.map((asset, index) => {
      const fingerprint = createDecisionFingerprint({
        id: `fingerprint-${index + 1}`,
        taskId: asset.taskId,
        entityId: asset.mediaAssetId,
        entityType: 'tag-assignment',
        taxonomyVersionId: 'taxonomy-v1',
        modelAdapterVersion: 'chatgpt:gpt-5.4',
        decisionClass: 'phase3-tagging',
        timestamp: '2026-04-24T19:01:00.000Z'
      });

      return runAutomaticTagging({
        taskId: asset.taskId,
        mediaAssetId: asset.mediaAssetId,
        taxonomyVersionId: 'taxonomy-v1',
        fingerprintId: fingerprint.id,
        candidateSetId: `candidate-set-${index + 1}`,
        assignmentId: `assignment-${index + 1}`,
        generatedAt: '2026-04-24T19:02:00.000Z',
        assignedAt: '2026-04-24T19:03:00.000Z',
        candidatePaths:
          index === 0
            ? ['内容题材 > 广告营销 > 产品广告']
            : ['主体对象 > 人物 > 年龄', '主体对象 > 植物'],
        taxonomyTree,
        promptLibrary
      });
    });

    writeTagResultsToSpreadsheet({
      filePath: spreadsheetPath,
      updates: assignments.map((assignment, index) => ({
        rowNumber: sheet.rows[index]!.rowNumber,
        acceptedPaths: assignment.acceptedPaths
      }))
    });

    const archiveRecords = await Promise.all(
      assignments.map(async (assignment, index) => {
        const asset = downloadBatch.downloadedAssets[index]!;
        const tagResultRecord = createTagResultRecord({
          assignment: assignment.assignment!,
          recordedAt: '2026-04-24T19:04:00.000Z'
        });

        const records = await archiveFileByPlans({
          sourceFilePath: asset.filePath,
          archiveRoot: tempDir,
          placementPlans: buildArchivePlacementPlans({
            acceptedPaths: tagResultRecord.acceptedPaths,
            fileName: asset.fileName
          }),
          placementMode: 'copy',
          taskId: asset.taskId,
          mediaAssetId: asset.mediaAssetId,
          taxonomyVersionId: 'taxonomy-v1',
          fingerprintId: `fingerprint-${index + 1}`,
          recordedAt: '2026-04-24T19:05:00.000Z'
        });

        return createArchiveIndexEntryFromRecords({
          id: `index-${index + 1}`,
          mediaAssetId: asset.mediaAssetId,
          taxonomyVersionId: 'taxonomy-v1',
          archiveRecords: records,
          latestTagResultRecordId: tagResultRecord.assignmentId,
          tagPaths: tagResultRecord.acceptedPaths,
          lastTaskId: asset.taskId,
          updatedAt: '2026-04-24T19:06:00.000Z'
        });
      })
    );

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<(string | number)[]>(
      updatedWorkbook.Sheets.Sheet1,
      { header: 1, blankrows: false, defval: '' }
    );

    assert.equal(downloadBatch.tasks.every((task) => task.status === 'succeeded'), true);
    assert.equal(downloadBatch.downloadedAssets.length, 2);
    assert.equal(downloadBatch.taggingScope.assetIds.length, 2);
    assert.equal(updatedSheet[1]?.includes('内容题材 > 广告营销 > 产品广告'), true);
    assert.equal(updatedSheet[2]?.includes('主体对象 > 人物 > 年龄'), true);
    assert.equal(
      await readFile(
        path.join(
          tempDir,
          '主体对象/人物/年龄/Sample_B_1080P_260424_000041.mp4'
        ),
        'utf8'
      ),
      'video:video-b\naudio:audio-b\n'
    );
    assert.equal(archiveRecords.length, 2);
    assert.equal(archiveRecords[0]?.tagPaths.length, 1);
    assert.equal(
      await readFile(path.join(tempDir, '内容题材/广告营销/产品广告/Sample_A_720P_260424_000027.mp4'), 'utf8'),
      'muxed-a'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
