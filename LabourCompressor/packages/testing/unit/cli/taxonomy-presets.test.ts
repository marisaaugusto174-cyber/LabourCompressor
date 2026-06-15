import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  listTaxonomyPresets,
  resolveTaxonomyInput
} from '../../../../apps/cli/taxonomy-presets.ts';

const projectRoot = path.resolve(import.meta.dirname, '../../../..');
const projectStandardDir = path.join(projectRoot, 'VideoGroup_Standard');

test('lists built-in taxonomy presets', () => {
  const presets = listTaxonomyPresets();

  assert.deepEqual(
    presets.map((preset) => preset.id),
    ['core-v0.2', 'core-v0.1', 'full-v0.2', 'business', 'v0']
  );
  assert.equal(presets[0]?.baseKind, 'structured');
  assert.equal(presets[0]?.taxonomyVersionId, 'Core_Prompt_V0.2');
  assert.equal(presets[0]?.archiveDimension, '内容领域');
  assert.equal(presets[0]?.modelResponseShape, 'structured-json');
});

test('prefers explicit taxonomy path over preset', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPath: '/tmp/custom-taxonomy.md',
      taxonomyPreset: 'v0'
    }),
    '/tmp/custom-taxonomy.md'
  );
});

test('resolves v0 preset to bundled taxonomy file', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPreset: 'v0'
    }),
    path.join(projectRoot, 'config/taxonomies/video-data-collection-taxonomy-v0-260415.md')
  );
});

test('resolves core v0.1 preset to the standard prompt base file', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPreset: 'core-v0.1'
    }),
    path.join(projectStandardDir, '核心视频标签体系_基座提示词规则_V0.1.md')
  );
});

test('resolves core v0.2 preset to the standard prompt base file', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPreset: 'core-v0.2'
    }),
    path.join(projectStandardDir, '核心视频标签体系_基座提示词规则_V0.2.md')
  );
});

test('defaults missing taxonomy inputs to core v0.2', () => {
  assert.equal(
    resolveTaxonomyInput({}),
    path.join(projectStandardDir, '核心视频标签体系_基座提示词规则_V0.2.md')
  );
});

test('preset paths are stable when the process runs outside the project root', () => {
  const originalCwd = process.cwd();

  try {
    process.chdir(path.dirname(projectRoot));

    assert.equal(
      resolveTaxonomyInput({
        taxonomyPreset: 'core-v0.2'
      }),
      path.join(projectStandardDir, '核心视频标签体系_基座提示词规则_V0.2.md')
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('structured prompt base preset files live inside the project standard directory', () => {
  for (const preset of listTaxonomyPresets().filter((item) => item.baseKind === 'structured')) {
    assert.equal(
      preset.filePath.startsWith(`${projectStandardDir}${path.sep}`),
      true,
      `${preset.id} should resolve inside project VideoGroup_Standard`
    );
    assert.equal(existsSync(preset.filePath), true, `${preset.id} file should exist`);
  }
});

test('rejects unknown taxonomy preset', () => {
  assert.throws(
    () =>
      resolveTaxonomyInput({
        taxonomyPreset: 'unknown'
      }),
    /Unknown taxonomy preset/
  );
});
