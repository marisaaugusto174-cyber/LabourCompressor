import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAssetSelectionTaggingScope,
  createDefaultDownloadBatchTaggingScope,
  createDirectoryTaggingScope,
  resolveScopedAssetIds
} from '../../../features/tagging/domain/index.ts';

test('creates default batch tagging scope', () => {
  const scope = createDefaultDownloadBatchTaggingScope({
    id: 'scope-1',
    batchId: 'batch-1',
    assetIds: ['asset-1', 'asset-2']
  });

  assert.equal(scope.kind, 'download-batch');
  assert.deepEqual(scope.assetIds, ['asset-1', 'asset-2']);
});

test('resolves asset selection scope against available assets', () => {
  const scope = createAssetSelectionTaggingScope({
    id: 'scope-2',
    assetIds: ['asset-1', 'asset-3']
  });

  const resolved = resolveScopedAssetIds(scope, ['asset-1', 'asset-2']);

  assert.deepEqual(resolved, ['asset-1']);
});

test('directory scope without explicit asset ids falls back to all available assets', () => {
  const scope = createDirectoryTaggingScope({
    id: 'scope-3',
    directoryPath: '/tmp/assets'
  });

  const resolved = resolveScopedAssetIds(scope, ['asset-1', 'asset-2']);

  assert.deepEqual(resolved, ['asset-1', 'asset-2']);
});
