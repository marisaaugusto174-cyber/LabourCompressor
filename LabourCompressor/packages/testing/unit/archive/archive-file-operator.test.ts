import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  archiveFileByPlans,
  verifyArchivedPaths
} from '../../../adapters/storage/filesystem/archive-file-operator.ts';
import { buildArchivePlacementPlans } from '../../../features/archive/domain/index.ts';

test('archives a file by copy placement plans and verifies outputs', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-archive-'));
  const sourceFilePath = path.join(tempDir, 'source.txt');

  try {
    writeFileSync(sourceFilePath, 'hello world');

    const plans = buildArchivePlacementPlans({
      acceptedPaths: ['主体对象 > 人物 > 年龄'],
      fileName: 'source.txt'
    });

    const records = await archiveFileByPlans({
      sourceFilePath,
      archiveRoot: tempDir,
      placementPlans: plans,
      placementMode: 'copy',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'taxonomy-v1',
      fingerprintId: 'fingerprint-1',
      recordedAt: '2026-04-24T16:00:00.000Z'
    });

    assert.equal(records.length, 1);
    assert.equal(await verifyArchivedPaths(tempDir, records), true);
    assert.equal(
      readFileSync(path.join(tempDir, records[0]!.archivePath), 'utf8'),
      'hello world'
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('archives json sidecars beside each archived media file', async () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'labour-compressor-archive-json-'));
  const sourceFilePath = path.join(tempDir, 'source.mp4');

  try {
    writeFileSync(sourceFilePath, 'video bytes');

    const records = await archiveFileByPlans({
      sourceFilePath,
      archiveRoot: tempDir,
      placementPlans: buildArchivePlacementPlans({
        acceptedPaths: ['内容领域 > 商业营销 > 产品广告'],
        fileName: 'source.mp4'
      }),
      placementMode: 'copy',
      taskId: 'task-1',
      mediaAssetId: 'asset-1',
      taxonomyVersionId: 'Core_Prompt_V0.1',
      fingerprintId: 'fingerprint-1',
      recordedAt: '2026-04-24T16:00:00.000Z',
      jsonSidecarContent: JSON.stringify({ taxonomy_version: 'Core_Prompt_V0.1' }, null, 2)
    });

    const mediaPath = path.join(tempDir, records[0]!.archivePath);
    const jsonPath = mediaPath.replace(/\.mp4$/u, '.json');
    assert.equal(existsSync(jsonPath), true);
    assert.deepEqual(JSON.parse(readFileSync(jsonPath, 'utf8')), {
      taxonomy_version: 'Core_Prompt_V0.1'
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
