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
  assert.equal(options.selectedModelProfileId, 'qwen-3.7-plus');
  assert.equal(options.taggingConcurrency, 16);
});

test('reports Web defaults from the shared options boundary', () => {
  const defaults = getWebPipelineDefaults();

  assert.equal(defaults.taxonomyPreset, 'core-v0.3-drama');
  assert.equal(
    defaults.promptLibrary,
    path.join(projectRoot, 'config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md')
  );
  assert.equal(defaults.downloaderMode, 'yt-dlp');
  assert.equal(defaults.mergeMode, 'ffmpeg');
  assert.equal(defaults.taggingMode, 'qwen');
  assert.equal(defaults.writebackTarget, 'both');
  assert.equal(defaults.manualEditGate, false);
  assert.equal(defaults.autoSegmentation, true);
  assert.equal(defaults.selectedModelProfileId, 'qwen-3.7-plus');
  assert.equal(defaults.taggingConcurrency, 16);
  assert.equal(defaults.downloadDir, path.join(projectRoot, '视频数据下载缓存'));
  assert.equal(defaults.archiveRoot, path.dirname(projectRoot));
  assert.equal(defaults.providerConfigPath, path.join(projectRoot, 'config/model-providers/providers.local.json'));
});

test('reads explicit tagging concurrency from Web and CLI inputs', () => {
  const defaults = getWebPipelineDefaults();
  const webOptions = buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    promptLibrary: defaults.promptLibrary,
    taggingConcurrency: '32'
  });
  const cliOptions = buildCliPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    'download-dir': '/tmp/downloads',
    'archive-root': '/tmp/archive',
    'prompt-library': '/tmp/prompt.md',
    taxonomy: '/tmp/taxonomy.md',
    'tagging-concurrency': '7'
  });

  assert.equal(webOptions.taggingConcurrency, 32);
  assert.equal(cliOptions.taggingConcurrency, 7);
});

test('clamps tagging concurrency to supported UI range', () => {
  const defaults = getWebPipelineDefaults();

  assert.equal(buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    promptLibrary: defaults.promptLibrary,
    taggingConcurrency: '0'
  }).taggingConcurrency, 1);
  assert.equal(buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    promptLibrary: defaults.promptLibrary,
    taggingConcurrency: '99'
  }).taggingConcurrency, 64);
});

test('explicit taxonomy path takes precedence over taxonomy preset in shared options', () => {
  const options = buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    taxonomyPath: '/tmp/custom-taxonomy.md',
    taxonomyPreset: 'core-v0.1',
    promptLibrary: '/tmp/prompt.md'
  });

  assert.equal(options.taxonomy, '/tmp/custom-taxonomy.md');
  assert.equal(options.taxonomyPreset, 'core-v0.1');
});

test('Web custom taxonomy path uses the same file as prompt base when prompt library is empty', () => {
  const options = buildWebPipelineOptions({
    spreadsheet: '/tmp/tasks.xlsx',
    downloadDir: '/tmp/downloads',
    archiveRoot: '/tmp/archive',
    taxonomyPath: '/tmp/custom-structured-taxonomy.md',
    taxonomyPreset: 'full-v0.2',
    promptLibrary: ''
  });

  assert.equal(options.taxonomy, '/tmp/custom-structured-taxonomy.md');
  assert.equal(options.promptLibrary, '/tmp/custom-structured-taxonomy.md');
});
