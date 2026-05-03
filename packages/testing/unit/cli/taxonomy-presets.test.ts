import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listTaxonomyPresets,
  resolveTaxonomyInput
} from '../../../../apps/cli/taxonomy-presets.ts';

test('lists built-in taxonomy presets', () => {
  const presets = listTaxonomyPresets();

  assert.deepEqual(
    presets.map((preset) => preset.id),
    ['business', 'v0']
  );
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
    '/Users/tianyi/Desktop/codex/jobtask/config/taxonomies/video-data-collection-taxonomy-v0-260415.md'
  );
});

test('rejects missing taxonomy inputs', () => {
  assert.throws(
    () => resolveTaxonomyInput({}),
    /--taxonomy or --taxonomy-preset/
  );
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
