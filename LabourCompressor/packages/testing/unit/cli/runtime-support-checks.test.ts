import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';

import {
  checkTaxonomyReadableAndParsable,
  runPipelinePreflight
} from '../../../../apps/web/runtime-support-checks.ts';

const xlsx = XLSX.default ?? XLSX;

test('taxonomy preflight validates that a custom taxonomy file can be parsed', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-taxonomy-check-'));
  const taxonomyPath = path.join(tempDir, 'custom-taxonomy.md');

  try {
    writeFileSync(
      taxonomyPath,
      '* 主体对象\n    * 人物\n        * 成人\n'
    );

    const result = await checkTaxonomyReadableAndParsable(
      taxonomyPath,
      'bullet-root'
    );

    assert.equal(result.ok, true);
    assert.equal(result.key, 'taxonomy');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('taxonomy preflight fails when a custom taxonomy file is not parseable', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-taxonomy-check-'));
  const taxonomyPath = path.join(tempDir, 'broken-taxonomy.md');

  try {
    writeFileSync(
      taxonomyPath,
      '# 主体对象\n\n- 人物\n'
    );

    const result = await checkTaxonomyReadableAndParsable(
      taxonomyPath,
      'bullet-root'
    );

    assert.equal(result.ok, false);
    assert.equal(result.key, 'taxonomy');
    assert.match(String(result.details?.error), /No parseable taxonomy roots/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('preflight treats stale yt-dlp as non-blocking when spreadsheet contains only douyin urls', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-douyin-preflight-'));
  const spreadsheetPath = path.join(tempDir, 'tasks.xlsx');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  const fakeYtDlpPath = path.join(tempDir, 'yt-dlp');

  try {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.aoa_to_sheet([
      ['URL', 'title'],
      ['https://www.douyin.com/video/7644853767707430186', 'a'],
      ['https://www.douyin.com/shipin/7647877768130104628', 'b']
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    xlsx.writeFile(workbook, spreadsheetPath);

    writeFileSync(taxonomyPath, '* 主体对象\n    * 人物\n        * 成人\n');
    writeFileSync(fakeYtDlpPath, '#!/usr/bin/env bash\necho 2026.03.17\n');
    chmodSync(fakeYtDlpPath, 0o755);

    const checks = await runPipelinePreflight({
      spreadsheet: spreadsheetPath,
      downloadDir: tempDir,
      taxonomy: taxonomyPath,
      taxonomyPreset: undefined,
      promptLibrary: taxonomyPath,
      archiveRoot: tempDir,
      downloaderMode: 'yt-dlp',
      mergeMode: 'ffmpeg',
      taggingMode: 'simulated',
      ytDlpBinary: fakeYtDlpPath
    });
    const ytDlpCheck = checks.find((check) => check.key === 'yt-dlp');

    assert.equal(ytDlpCheck?.ok, true);
    assert.equal(ytDlpCheck?.details?.isStale, true);
    assert.match(ytDlpCheck?.message ?? '', /Douyin SSR/u);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('user sheet preflight checks the spreadsheet parent instead of the old download directory', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-user-workspace-preflight-'));
  const sourceDir = path.join(tempDir, 'readonly-source');
  const spreadsheetPath = path.join(sourceDir, 'tasks.xlsx');
  const taxonomyPath = path.join(tempDir, 'taxonomy.md');
  try {
    mkdirSync(sourceDir);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(
      workbook,
      xlsx.utils.aoa_to_sheet([['URL'], ['https://example.com/video']]),
      'Sheet1'
    );
    xlsx.writeFile(workbook, spreadsheetPath);
    writeFileSync(taxonomyPath, '* 主体对象\n    * 人物\n        * 成人\n');
    chmodSync(sourceDir, 0o555);

    const checks = await runPipelinePreflight({
      spreadsheet: spreadsheetPath,
      downloadDir: tempDir,
      taxonomy: taxonomyPath,
      promptLibrary: taxonomyPath,
      archiveRoot: tempDir,
      downloaderMode: 'simulated',
      mergeMode: 'local',
      taggingMode: 'simulated'
    }, { userSheetWorkspace: true });

    assert.equal(
      checks.some((item) => item.key === 'user-sheet-directory' && !item.ok),
      true
    );
    assert.equal(checks.some((item) => item.key === 'download-dir'), false);
  } finally {
    chmodSync(sourceDir, 0o755);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
