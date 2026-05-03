import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  buildArchivePlacementPlans,
  createArchiveIndexEntryFromRecords
} from '../../../features/archive/domain/index.ts';
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

test('runs phase 2 closed loop from tagging to writeback and archive', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase2-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const sourceFilePath = path.join(tempDir, 'asset.txt');

  try {
    writeFileSync(sourceFilePath, 'phase2 asset');

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['url', 'title'],
      ['https://example.com/a', 'Sample A']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    const sheet = readSpreadsheetTaskSheet({
      filePath: spreadsheetPath,
      urlColumnName: 'url'
    });
    const row = sheet.rows[0]!;
    const fingerprint = createDecisionFingerprint({
      id: 'fingerprint-1',
      taskId: row.taskId,
      entityId: 'asset-1',
      entityType: 'tag-assignment',
      taxonomyVersionId: 'taxonomy-v1',
      modelAdapterVersion: 'chatgpt:gpt-5.4',
      decisionClass: 'phase2-tagging',
      timestamp: '2026-04-24T16:30:00.000Z'
    });
    const taxonomyTree = parseTaxonomyMarkdown(`
## 1. 主体对象（末端计数：2）

- 人物
  - 年龄
`);
    const promptLibrary = parsePromptLibraryMarkdown(`
# 标注提示词库

## 规则
- 只能输出标签库中的标签
`);

    const taggingResult = runAutomaticTagging({
      taskId: row.taskId,
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: fingerprint.id,
      candidateSetId: 'candidate-set-1',
      assignmentId: 'assignment-1',
      generatedAt: '2026-04-24T16:31:00.000Z',
      assignedAt: '2026-04-24T16:32:00.000Z',
      candidatePaths: ['主体对象 > 人物 > 年龄', '主体对象 > 植物'],
      taxonomyTree,
      promptLibrary
    });

    assert.equal(taggingResult.assignment !== undefined, true);

    writeTagResultsToSpreadsheet({
      filePath: spreadsheetPath,
      updates: [
        {
          rowNumber: row.rowNumber,
          acceptedPaths: taggingResult.acceptedPaths
        }
      ]
    });

    const tagResultRecord = createTagResultRecord({
      assignment: taggingResult.assignment!,
      recordedAt: '2026-04-24T16:33:00.000Z'
    });
    const archiveRecords = await archiveFileByPlans({
      sourceFilePath,
      archiveRoot: tempDir,
      placementPlans: buildArchivePlacementPlans({
        acceptedPaths: taggingResult.acceptedPaths,
        fileName: 'asset.txt'
      }),
      placementMode: 'copy',
      taskId: row.taskId,
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: fingerprint.id,
      recordedAt: '2026-04-24T16:34:00.000Z'
    });
    const indexEntry = createArchiveIndexEntryFromRecords({
      id: 'index-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      archiveRecords,
      latestTagResultRecordId: tagResultRecord.assignmentId,
      tagPaths: tagResultRecord.acceptedPaths,
      lastTaskId: row.taskId,
      updatedAt: '2026-04-24T16:35:00.000Z'
    });

    const updatedWorkbook = xlsx.readFile(spreadsheetPath);
    const updatedSheet = xlsx.utils.sheet_to_json<(string | number)[]>(
      updatedWorkbook.Sheets.Sheet1,
      {
        header: 1,
        blankrows: false,
        defval: ''
      }
    );

    assert.equal(updatedSheet[1]?.includes('主体对象 > 人物 > 年龄'), true);
    assert.equal(indexEntry.currentArchiveRecordId, archiveRecords[0]!.id);
    assert.equal(
      await readFile(path.join(tempDir, archiveRecords[0]!.archivePath), 'utf8'),
      'phase2 asset'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
