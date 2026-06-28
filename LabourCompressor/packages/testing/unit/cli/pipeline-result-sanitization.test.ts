import test from 'node:test';
import assert from 'node:assert/strict';

import { toResultItem } from '../../../../apps/cli/local-pipeline-after-edit.ts';
import { buildFailure } from '../../../../apps/cli/local-pipeline-helpers.ts';

const SENSITIVE_URL = 'https://www.xiaohongshu.com/explore/abc123?xsec_token=secret&xsec_source=pc_feed';

test('pipeline result and failure DTOs remove Xiaohongshu query credentials', () => {
  const failure = buildFailure({
    row: createRow(),
    phase: 'download',
    errorCode: 'failed',
    errorMessage: 'failed',
    timestamp: '2026-06-28T00:00:00.000Z'
  });
  const result = toResultItem({
    rowNumber: 2,
    url: SENSITIVE_URL,
    collector: 'tester',
    archiveState: '下载失败',
    levelValues: {},
    archivePath: '',
    archiveFileName: '',
    acceptedPaths: [],
    failure
  });

  assert.equal(result.url, 'https://www.xiaohongshu.com/explore/abc123');
  assert.equal(result.failure?.url, 'https://www.xiaohongshu.com/explore/abc123');
  assert.doesNotMatch(JSON.stringify(result), /xsec_token|secret/u);
});

function createRow() {
  return {
    taskId: 'task:2',
    rowNumber: 2,
    url: SENSITIVE_URL,
    sourceKind: 'url' as const,
    values: {}
  };
}
