import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { importSourceMediaDirectory } from '../../../../apps/web/source-intake.ts';

const xlsx = XLSX.default ?? XLSX;

test('importSourceMediaDirectory copies source videos into AfterEdit without mutating the source directory', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'source-intake-copy-'));
  const sourceDirectoryPath = path.join(tempDir, 'network-share');
  const nestedDirectoryPath = path.join(sourceDirectoryPath, 'nested');
  const downloadDirectory = path.join(tempDir, 'downloads');
  const sourcePath = path.join(nestedDirectoryPath, '素材A_720P_260626_000001.mp4');

  try {
    mkdirSync(nestedDirectoryPath, { recursive: true });
    writeFileSync(sourcePath, 'video');

    const result = await importSourceMediaDirectory({
      sourceDirectoryPath,
      downloadDirectory,
      afterEditDirectoryName: 'AfterEdit'
    });

    assert.equal(result.fileCount, 1);
    assert.equal(result.copiedCount, 1);
    assert.equal(result.renamedCount, 0);
    assert.equal(existsSync(sourcePath), true);

    const copiedPath = path.join(downloadDirectory, 'AfterEdit', '素材A_720P_260626_000001.mp4');
    assert.equal(existsSync(copiedPath), true);
    assert.equal(result.files[0]?.sourceRelativePath, 'nested/素材A_720P_260626_000001.mp4');
    assert.equal(result.files[0]?.relativePath, '素材A_720P_260626_000001.mp4');

    const workbook = xlsx.readFile(result.outputFilePath);
    const records = xlsx.utils.sheet_to_json<Record<string, string>>(
      workbook.Sheets[workbook.SheetNames[0]!]!,
      { defval: '' }
    );

    assert.equal(path.basename(result.outputFilePath), 'SourceIntake_素材导入表.xlsx');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.文件名, '素材A_720P_260626_000001.mp4');
    assert.equal(records[0]?.归档状态, '待压缩');
    assert.equal(records[0]?.源文件路径, sourcePath);
    assert.equal(records[0]?.当前文件路径, copiedPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importSourceMediaDirectory standardizes copied file names and keeps original names untouched', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'source-intake-standardize-'));
  const sourceDirectoryPath = path.join(tempDir, 'local-folder');
  const downloadDirectory = path.join(tempDir, 'downloads');
  const sourcePath = path.join(sourceDirectoryPath, 'plain export.mp4');

  try {
    mkdirSync(sourceDirectoryPath, { recursive: true });
    writeFileSync(sourcePath, 'video');
    const exportedAt = new Date('2026-06-26T08:00:00.000Z');
    utimesSync(sourcePath, exportedAt, exportedAt);

    const result = await importSourceMediaDirectory({
      sourceDirectoryPath,
      downloadDirectory
    });

    const imported = result.files[0];
    assert.ok(imported);
    assert.equal(result.renamedCount, 1);
    assert.equal(existsSync(sourcePath), true);
    assert.match(imported.fileName, /^plain_export_0P_260626_000000\.mp4$/u);
    assert.equal(existsSync(imported.currentFilePath), true);
    assert.equal(path.basename(imported.currentFilePath), imported.fileName);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
