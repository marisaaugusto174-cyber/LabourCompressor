import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  buildCliPipelineOptions,
  buildWebPipelineOptions,
  getWebPipelineDefaults
} from '../../../../apps/cli/pipeline/options.ts';

const projectRoot = path.resolve(import.meta.dirname, '../../../..');

test('builds CLI pipeline options with CLI defaults', () => {
  const options = buildCliPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    'download-dir': '/tmp/downloads',
    'archive-root': '/tmp/archive',
    'prompt-library': '/tmp/prompt.md',
    taxonomy: '/tmp/taxonomy.md'
  });

  assert.equal(options.downloaderMode, 'simulated');
  assert.equal(options.mergeMode, 'local');
  assert.equal(options.taggingMode, 'simulated');
  assert.equal(options.writebackTarget, 'user');
  assert.equal(options.taxonomy, '/tmp/taxonomy.md');
  assert.equal(options.promptLibrary, '/tmp/prompt.md');
});

test('builds Web pipeline options with Web defaults', () => {
  const defaults = getWebPipelineDefaults();
  const options = buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    promptLibrary: defaults.promptLibrary
  });

  assert.equal(options.downloaderMode, 'yt-dlp');
  assert.equal(options.mergeMode, 'ffmpeg');
  assert.equal(options.taggingMode, 'qwen');
  assert.equal(options.writebackTarget, 'both');
  assert.equal(options.manualEditGate, true);
  assert.equal(options.autoSegmentation, false);
  assert.equal(options.selectedModelProfileId, 'qwen-3.6-flash');
});

test('reports Web defaults from the shared options boundary', () => {
  const defaults = getWebPipelineDefaults();

  assert.equal(defaults.taxonomyPreset, 'core-v0.2');
  assert.equal(defaults.downloaderMode, 'yt-dlp');
  assert.equal(defaults.mergeMode, 'ffmpeg');
  assert.equal(defaults.taggingMode, 'qwen');
  assert.equal(defaults.writebackTarget, 'both');
  assert.equal(defaults.manualEditGate, false);
  assert.equal(defaults.autoSegmentation, true);
  assert.equal(defaults.downloadDir, path.join(projectRoot, '视频数据下载缓存'));
  assert.equal(defaults.archiveRoot, path.dirname(projectRoot));
  assert.equal(defaults.providerConfigPath, path.join(projectRoot, 'config/model-providers/providers.local.json'));
});

test('explicit taxonomy path takes precedence over taxonomy preset in shared options', () => {
  const options = buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    taxonomyPath: '/tmp/custom-taxonomy.md',
    taxonomyPreset: 'v0',
    promptLibrary: '/tmp/prompt.md'
  });

  assert.equal(options.taxonomy, '/tmp/custom-taxonomy.md');
  assert.equal(options.taxonomyPreset, 'v0');
});
