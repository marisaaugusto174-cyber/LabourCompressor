import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  importExternalTaxonomyPreset,
  loadTaxonomyPresetRepository,
  listTaxonomyPresets,
  resolveTaxonomyInput
} from '../../../../apps/cli/taxonomy-presets.ts';
import { parseTaxonomyMarkdown } from '../../../features/taxonomy/domain/index.ts';

const projectRoot = path.resolve(import.meta.dirname, '../../../..');
const projectStandardDir = path.join(projectRoot, 'VideoGroup_Standard');
const projectTaxonomyRepositoryDir = path.join(projectRoot, 'config/repositories/taxonomies');

test('lists built-in taxonomy presets', () => {
  const presets = listTaxonomyPresets();
  const internalPresets = presets.filter((preset) => preset.source === 'internal');
  const coreDramaPreset = presets.find((preset) => preset.id === 'core-v0.3-drama');

  assert.deepEqual(
    internalPresets.map((preset) => preset.id),
    ['core-v0.1', 'full-v0.2']
  );
  assert.equal(internalPresets[0]?.baseKind, 'structured');
  assert.equal(internalPresets[0]?.taxonomyVersionId, 'Core_Prompt_V0.1');
  assert.equal(internalPresets[0]?.archiveDimension, '内容领域');
  assert.equal(internalPresets[0]?.modelResponseShape, 'structured-json');
  assert.equal(internalPresets[0]?.source, 'internal');
  assert.equal(internalPresets[1]?.source, 'internal');
  assert.equal(internalPresets[0]?.archivePathPolicy, undefined);
  assert.equal(internalPresets[1]?.archivePathPolicy, undefined);
  assert.equal(coreDramaPreset?.source, 'external');
  assert.deepEqual(coreDramaPreset?.archivePathPolicy, {
    dimension: '核心动作',
    primaryRole: '主动作',
    requiredCount: 1,
    onInvalid: 'retry-once-then-review'
  });
});

test('prefers explicit taxonomy path over preset', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPath: '/tmp/custom-taxonomy.md',
      taxonomyPreset: 'core-v0.1'
    }),
    '/tmp/custom-taxonomy.md'
  );
});

test('resolves external core v0.3 drama preset to the taxonomy repository file', () => {
  const preset = listTaxonomyPresets().find((item) => item.id === 'core-v0.3-drama');

  assert.ok(preset);
  assert.equal(preset.label, '核心基座标签提示词 V0.3 戏核增强候选');
  assert.equal(preset.taxonomyVersionId, 'Core_Base_Prompt_V0.3_Drama_Core_Candidate');
  assert.equal(preset.archiveDimension, '内容领域');
  assert.equal(preset.modelResponseShape, 'structured-json');
  assert.equal(preset.taxonomyParseMode, 'bullet-root');
  assert.equal(preset.source, 'external');
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPreset: 'core-v0.3-drama'
    }),
    path.join(projectRoot, 'config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md')
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

test('resolves full v0.2 preset to the standard prompt base file', () => {
  assert.equal(
    resolveTaxonomyInput({
      taxonomyPreset: 'full-v0.2'
    }),
    path.join(projectStandardDir, '完整视频标签体系_基座提示词规则_V0.2.md')
  );
});

test('defaults missing taxonomy inputs to core v0.3 drama candidate', () => {
  assert.equal(
    resolveTaxonomyInput({}),
    path.join(projectRoot, 'config/repositories/taxonomies/核心基座_标签提示词_V0.3_戏核增强候选.md')
  );
});

test('preset paths are stable when the process runs outside the project root', () => {
  const originalCwd = process.cwd();

  try {
    process.chdir(path.dirname(projectRoot));

    assert.equal(
      resolveTaxonomyInput({
        taxonomyPreset: 'full-v0.2'
      }),
      path.join(projectStandardDir, '完整视频标签体系_基座提示词规则_V0.2.md')
    );
  } finally {
    process.chdir(originalCwd);
  }
});

test('structured prompt base preset files live inside their configured library directory', () => {
  for (const preset of listTaxonomyPresets().filter((item) => item.baseKind === 'structured')) {
    const expectedDirectory = preset.source === 'internal'
      ? projectStandardDir
      : projectTaxonomyRepositoryDir;

    assert.equal(
      preset.filePath.startsWith(`${expectedDirectory}${path.sep}`),
      true,
      `${preset.id} should resolve inside ${expectedDirectory}`
    );
    assert.equal(existsSync(preset.filePath), true, `${preset.id} file should exist`);
  }
});

test('structured prompt base presets contain their configured archive dimension', () => {
  for (const preset of listTaxonomyPresets().filter((item) => item.baseKind === 'structured')) {
    const taxonomyTree = parseTaxonomyMarkdown(
      readFileSync(preset.filePath, 'utf8'),
      { rootMode: preset.taxonomyParseMode }
    );
    const rootLabels = taxonomyTree.nodes
      .filter((node) => node.depth === 0)
      .map((node) => node.label);

    assert.equal(
      rootLabels.includes(preset.archiveDimension),
      true,
      `${preset.id} should contain archive dimension ${preset.archiveDimension}`
    );
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

test('loadTaxonomyPresetRepository reads custom taxonomy manifests', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'taxonomy-presets-'));

  try {
    writeFileSync(path.join(tempDir, 'taxonomy.md'), '# Taxonomy\n');
    writeFileSync(path.join(tempDir, 'prompt.md'), '# Prompt\n');
    writeFileSync(
      path.join(tempDir, 'taxonomy.json'),
      JSON.stringify({
        id: 'project-taxonomy',
        label: 'Project Taxonomy',
        filePath: 'taxonomy.md',
        description: 'Custom project taxonomy.',
        baseKind: 'structured',
        taxonomyVersionId: 'Project_V1',
        archiveDimension: '内容领域',
        modelResponseShape: 'structured-json',
        taxonomyParseMode: 'bullet-root',
        promptLibraryPath: 'prompt.md'
      })
    );

    const presets = loadTaxonomyPresetRepository(tempDir);

    assert.equal(presets.length, 1);
    assert.equal(presets[0]?.id, 'project-taxonomy');
    assert.equal(presets[0]?.filePath, path.join(tempDir, 'taxonomy.md'));
    assert.equal(presets[0]?.promptLibraryPath, path.join(tempDir, 'prompt.md'));
    assert.equal(presets[0]?.source, 'external');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadTaxonomyPresetRepository rejects invalid archive path policies', () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'taxonomy-presets-'));

  try {
    writeFileSync(path.join(tempDir, 'taxonomy.md'), '# Taxonomy\n');
    writeFileSync(
      path.join(tempDir, 'taxonomy.json'),
      JSON.stringify({
        id: 'invalid-archive-policy',
        label: 'Invalid Archive Policy',
        filePath: 'taxonomy.md',
        description: 'Invalid archive policy fixture.',
        baseKind: 'structured',
        taxonomyVersionId: 'Invalid_Archive_Policy_V1',
        archiveDimension: '内容领域',
        archivePathPolicy: {
          dimension: '核心动作',
          primaryRole: '主动作',
          requiredCount: 2,
          onInvalid: 'retry-once-then-review'
        },
        modelResponseShape: 'structured-json',
        taxonomyParseMode: 'bullet-root'
      })
    );

    assert.throws(
      () => loadTaxonomyPresetRepository(tempDir),
      /archivePathPolicy/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('importExternalTaxonomyPreset copies a taxonomy file and writes a repository manifest', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'taxonomy-import-'));
  const sourceFilePath = path.join(tempDir, '客户标签库.md');
  const repositoryDirectory = path.join(tempDir, 'repository');

  try {
    writeFileSync(sourceFilePath, '- 内容领域\n  - 商业营销\n');

    const preset = await importExternalTaxonomyPreset({
      sourceFilePath,
      repositoryDirectory,
      label: '客户标签库'
    });

    assert.match(preset.id, /^custom-taxonomy-[a-z0-9-]+$/u);
    assert.equal(preset.label, '客户标签库');
    assert.equal(preset.source, 'external');
    assert.equal(preset.baseKind, 'structured');
    assert.equal(preset.archiveDimension, '内容领域');
    assert.deepEqual(preset.archivePathPolicy, {
      dimension: '核心动作',
      primaryRole: '主动作',
      requiredCount: 1,
      onInvalid: 'retry-once-then-review'
    });
    assert.equal(preset.modelResponseShape, 'structured-json');
    assert.equal(preset.taxonomyParseMode, 'bullet-root');
    assert.equal(preset.filePath, path.join(repositoryDirectory, '客户标签库.md'));
    assert.equal(preset.promptLibraryPath, preset.filePath);
    assert.equal(readFileSync(preset.filePath, 'utf8'), '- 内容领域\n  - 商业营销\n');

    const importedPresets = loadTaxonomyPresetRepository(repositoryDirectory);
    assert.equal(importedPresets.length, 1);
    assert.equal(importedPresets[0]?.id, preset.id);
    assert.equal(importedPresets[0]?.filePath, preset.filePath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
