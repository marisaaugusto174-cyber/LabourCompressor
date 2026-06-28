import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildMigrationPackageFileList,
  isForbiddenMigrationPackagePath
} from '../../../../scripts/package-migration-source.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '../../../..');

test('migration source package manifest excludes private and heavyweight local artifacts', async () => {
  const files = await buildMigrationPackageFileList(PROJECT_ROOT);

  assert.equal(files.includes('README.md'), true);
  assert.equal(files.includes('package.json'), true);
  assert.equal(files.includes('Start LabourCompressor.command'), true);
  assert.equal(files.includes('config/model-providers/providers.template.json'), true);
  assert.equal(files.includes('config/download-platform-credentials.template.json'), true);

  for (const forbidden of [
    'node_modules/xlsx/package.json',
    '.tools/scenedetect-venv/bin/scenedetect',
    'dist/LabourCompressor.app/Contents/Resources/launcher.sh',
    'config/model-providers/providers.local.json',
    'config/download-platform-credentials.local.json',
    '.cache/video-tagging/cache.mp4',
    '.runtime-state/tasks.json',
    '.runtime-uploads/upload.xlsx',
    '视频数据下载缓存/source.mp4',
    '视频数据归档库/内容题材/ad.mp4',
    '视频数据采集总表.xlsx',
    '.DS_Store'
  ]) {
    assert.equal(files.includes(forbidden), false, `included forbidden path: ${forbidden}`);
    assert.equal(isForbiddenMigrationPackagePath(forbidden), true, `not forbidden: ${forbidden}`);
  }
});

test('root command launcher locates project root from its own path', async () => {
  const launcher = await readFile(
    path.join(PROJECT_ROOT, 'Start LabourCompressor.command'),
    'utf8'
  );

  assert.match(launcher, /SCRIPT_DIR=/u);
  assert.match(launcher, /ROOT_DIR=/u);
  assert.match(launcher, /scripts\/setup-macos\.sh/u);
  assert.match(launcher, /dist\/LabourCompressor\.app/u);
  assert.doesNotMatch(launcher, /\/Users\/tianyi\/Desktop\/codex\/jobtask/u);
});
