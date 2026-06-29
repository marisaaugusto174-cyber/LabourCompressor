import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DEFAULT_SEGMENTATION_DURATION_POLICY,
  loadSegmentationProfileRepository,
  listSegmentationProfileDefinitions
} from '../../../../apps/cli/segmentation-profiles.ts';

test('listSegmentationProfileDefinitions includes built-in V0.3 segmentation profiles', async () => {
  const profiles = await listSegmentationProfileDefinitions({ repositoryDirectory: path.join(tmpdir(), 'missing-profiles') });

  assert.deepEqual(
    profiles.map((profile) => profile.id),
    ['standard_ad', 'fast_cut', 'conservative']
  );
  assert.equal(profiles.find((profile) => profile.id === 'standard_ad')?.detector, 'adaptive');
  assert.deepEqual(DEFAULT_SEGMENTATION_DURATION_POLICY, {
    minimumSeconds: 5,
    preferredMinimumSeconds: 5,
    preferredMaximumSeconds: 30,
    maximumSeconds: 60
  });
  assert.equal(
    profiles.every((profile) =>
      profile.minimumSeconds === 5 &&
      profile.preferredMinimumSeconds === 5 &&
      profile.preferredMaximumSeconds === 30 &&
      profile.maximumSeconds === 60
    ),
    true
  );
});

test('loadSegmentationProfileRepository reads custom profile manifests', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'segmentation-profiles-'));

  try {
    writeFileSync(
      path.join(tempDir, 'micro-cut.json'),
      JSON.stringify({
        id: 'micro_cut',
        label: 'Micro Cut',
        detector: 'content',
        minimumSeconds: 5,
        preferredMinimumSeconds: 5,
        preferredMaximumSeconds: 30,
        maximumSeconds: 60
      })
    );

    const profiles = await loadSegmentationProfileRepository(tempDir);

    assert.equal(profiles.length, 1);
    assert.equal(profiles[0]?.id, 'micro_cut');
    assert.equal(profiles[0]?.source, 'repository');
    assert.equal(profiles[0]?.preferredMaximumSeconds, 30);
    assert.equal(profiles[0]?.maximumSeconds, 60);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadSegmentationProfileRepository rejects profiles outside the unified duration policy', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'segmentation-profiles-invalid-'));

  try {
    writeFileSync(
      path.join(tempDir, 'bad.json'),
      JSON.stringify({
        id: 'bad',
        detector: 'adaptive',
        minimumSeconds: 5,
        preferredMinimumSeconds: 5,
        preferredMaximumSeconds: 30,
        maximumSeconds: 30
      })
    );

    await assert.rejects(
      () => loadSegmentationProfileRepository(tempDir),
      /unified 5-30-60 duration policy/u
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
