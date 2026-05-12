import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { runLocalPipelineCommand } from '../../../../apps/cli/local-pipeline-command.ts';

const xlsx = XLSX.default ?? XLSX;

test('local pipeline auto-segments remote downloads before tagging and archiving', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-phase5-auto-seg-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const downloadDir = path.join(tempDir, 'downloads');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const promptLibraryPath = path.join(tempDir, 'prompt-library.md');
  const downloadFixturesPath = path.join(tempDir, 'download-fixtures.json');
  const candidateFixturesPath = path.join(tempDir, 'candidate-fixtures.json');

  try {
    writeWorkbook(spreadsheetPath);
    writeSharedFiles({
      taxonomyPath,
      promptLibraryPath,
      downloadFixturesPath,
      candidateFixturesPath
    });

    const result = await runLocalPipelineCommand({
      options: {
        spreadsheet: spreadsheetPath,
        downloadDir,
        taxonomy: taxonomyPath,
        promptLibrary: promptLibraryPath,
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

    const archiveDir = path.join(tempDir, '视频数据归档库/内容题材/广告营销/产品广告');
    const firstClip = path.join(archiveDir, 'Sample_A_720P_260512_000023_01.mp4');
    const secondClip = path.join(archiveDir, 'Sample_A_720P_260512_000023_02.mp4');
    const sourceArchivePath = path.join(archiveDir, 'Sample_A_720P_260512_000045.mp4');

    assert.equal(result.failures.length, 0);
    assert.equal(existsSync(firstClip), true);
    assert.equal(existsSync(secondClip), true);
    assert.equal(existsSync(sourceArchivePath), false);
    assert.equal(await readFile(firstClip, 'utf8'), '0-22.5');
    assert.equal(await readFile(secondClip, 'utf8'), '22.5-45');
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

function writeSharedFiles(input: {
  readonly taxonomyPath: string;
  readonly promptLibraryPath: string;
  readonly downloadFixturesPath: string;
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
      'https://www.youtube.com/watch?v=auto-seg': ['内容题材 > 广告营销 > 产品广告'],
      'https://youtube.com/watch?v=auto-seg': ['内容题材 > 广告营销 > 产品广告']
    })
  );
}
