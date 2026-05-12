import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProblemClipRecord,
  createSegmentRecord
} from '../../../features/segmentation/domain/index.ts';

test('creates accepted segment record with duration and source trace', () => {
  const record = createSegmentRecord({
    id: 'seg-1',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 1,
    startSeconds: 10,
    endSeconds: 22,
    outputPath: '/tmp/AfterEdit/ad_720P_260512_000012_01.mp4',
    outputFileName: 'ad_720P_260512_000012_01.mp4',
    profileId: 'standard_ad',
    decisionFingerprintId: 'fp-1'
  });

  assert.equal(record.durationSeconds, 12);
  assert.equal(record.status, 'accepted');
  assert.equal(record.segmentIndex, 1);
});

test('creates problem clip record with one of the three V0.3 categories', () => {
  const record = createProblemClipRecord({
    id: 'problem-1',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 2,
    problemCategory: 'detection-result-invalid',
    outputPath: '/tmp/ProblemClips/source_problem_02.mp4',
    outputFileName: 'source_problem_02.mp4',
    profileId: 'standard_ad',
    decisionFingerprintId: 'fp-2'
  });

  assert.equal(record.status, 'problem');
  assert.equal(record.problemCategory, 'detection-result-invalid');
});

test('rejects accepted segment record with NaN time values', () => {
  assert.throws(() => {
    createSegmentRecord({
      ...createValidSegmentInput(),
      startSeconds: Number.NaN
    });
  }, /Segment startSeconds must be finite/);

  assert.throws(() => {
    createSegmentRecord({
      ...createValidSegmentInput(),
      endSeconds: Number.NaN
    });
  }, /Segment endSeconds must be finite/);
});

test('rejects accepted segment record with invalid index or time range', () => {
  for (const segmentIndex of [0, -1]) {
    assert.throws(() => {
      createSegmentRecord({
        ...createValidSegmentInput(),
        segmentIndex
      });
    }, /Segment index must be a positive integer/);
  }

  for (const endSeconds of [10, 9]) {
    assert.throws(() => {
      createSegmentRecord({
        ...createValidSegmentInput(),
        startSeconds: 10,
        endSeconds
      });
    }, /Segment endSeconds must be greater than startSeconds/);
  }
});

test('rejects unknown V0.3 profile and problem category values', () => {
  assert.throws(() => {
    createSegmentRecord({
      ...createValidSegmentInput(),
      profileId: 'unknown_profile' as 'standard_ad'
    });
  }, /Segmentation profileId must be a known V0\.3 profile/);

  assert.throws(() => {
    createProblemClipRecord({
      ...createValidProblemInput(),
      problemCategory: 'unknown-category' as 'detection-result-invalid'
    });
  }, /Problem clip category must be a known V0\.3 problem category/);
});

test('rejects empty required trace fields for segment and problem records', () => {
  const traceFields = [
    'id',
    'sourceAssetId',
    'sourceFilePath',
    'sourceHash',
    'outputPath',
    'outputFileName',
    'decisionFingerprintId'
  ] as const;

  for (const fieldName of traceFields) {
    assert.throws(() => {
      createSegmentRecord({
        ...createValidSegmentInput(),
        [fieldName]: '   '
      });
    }, /must not be empty/);

    assert.throws(() => {
      createProblemClipRecord({
        ...createValidProblemInput(),
        [fieldName]: '   '
      });
    }, /must not be empty/);
  }
});

test('normalizes required trace fields for segment and problem records', () => {
  const segmentRecord = createSegmentRecord({
    ...createValidSegmentInput(),
    id: ' seg-2 ',
    sourceAssetId: ' asset-1 ',
    sourceFilePath: ' /tmp/source.mp4 ',
    sourceHash: ' hash-1 ',
    outputPath: ' /tmp/AfterEdit/ad_720P_260512_000012_02.mp4 ',
    outputFileName: ' ad_720P_260512_000012_02.mp4 ',
    decisionFingerprintId: ' fp-3 '
  });

  assert.equal(segmentRecord.id, 'seg-2');
  assert.equal(segmentRecord.sourceAssetId, 'asset-1');
  assert.equal(segmentRecord.sourceFilePath, '/tmp/source.mp4');
  assert.equal(segmentRecord.sourceHash, 'hash-1');
  assert.equal(
    segmentRecord.outputPath,
    '/tmp/AfterEdit/ad_720P_260512_000012_02.mp4'
  );
  assert.equal(segmentRecord.outputFileName, 'ad_720P_260512_000012_02.mp4');
  assert.equal(segmentRecord.decisionFingerprintId, 'fp-3');

  const problemRecord = createProblemClipRecord({
    ...createValidProblemInput(),
    id: ' problem-2 ',
    sourceAssetId: ' asset-1 ',
    sourceFilePath: ' /tmp/source.mp4 ',
    sourceHash: ' hash-1 ',
    outputPath: ' /tmp/ProblemClips/source_problem_03.mp4 ',
    outputFileName: ' source_problem_03.mp4 ',
    decisionFingerprintId: ' fp-4 '
  });

  assert.equal(problemRecord.id, 'problem-2');
  assert.equal(problemRecord.sourceAssetId, 'asset-1');
  assert.equal(problemRecord.sourceFilePath, '/tmp/source.mp4');
  assert.equal(problemRecord.sourceHash, 'hash-1');
  assert.equal(problemRecord.outputPath, '/tmp/ProblemClips/source_problem_03.mp4');
  assert.equal(problemRecord.outputFileName, 'source_problem_03.mp4');
  assert.equal(problemRecord.decisionFingerprintId, 'fp-4');
});

function createValidSegmentInput() {
  return {
    id: 'seg-2',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 1,
    startSeconds: 10,
    endSeconds: 22,
    outputPath: '/tmp/AfterEdit/ad_720P_260512_000012_02.mp4',
    outputFileName: 'ad_720P_260512_000012_02.mp4',
    profileId: 'standard_ad' as const,
    decisionFingerprintId: 'fp-3'
  };
}

function createValidProblemInput() {
  return {
    id: 'problem-2',
    sourceAssetId: 'asset-1',
    sourceFilePath: '/tmp/source.mp4',
    sourceHash: 'hash-1',
    segmentIndex: 2,
    problemCategory: 'detection-result-invalid' as const,
    outputPath: '/tmp/ProblemClips/source_problem_03.mp4',
    outputFileName: 'source_problem_03.mp4',
    profileId: 'standard_ad' as const,
    decisionFingerprintId: 'fp-4'
  };
}
