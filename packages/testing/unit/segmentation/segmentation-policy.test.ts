import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleSegments,
  enforceSegmentDurations
} from '../../../features/segmentation/domain/index.ts';

test('merges sub-3s shots into adjacent continuity group', () => {
  const segments = assembleSegments({
    shots: [
      { startSeconds: 0, endSeconds: 1.2 },
      { startSeconds: 1.2, endSeconds: 4.8 },
      { startSeconds: 4.8, endSeconds: 10 }
    ],
    continuity: [
      {
        leftShotIndex: 0,
        rightShotIndex: 1,
        mergeWithNext: true,
        reasonCode: 'action_continuity'
      },
      {
        leftShotIndex: 1,
        rightShotIndex: 2,
        mergeWithNext: false,
        reasonCode: 'transition_boundary'
      }
    ]
  });

  assert.deepEqual(segments, [
    { startSeconds: 0, endSeconds: 4.8 },
    { startSeconds: 4.8, endSeconds: 10 }
  ]);
});

test('rounds assembled segment ranges to 3 decimals', () => {
  const segments = assembleSegments({
    shots: [
      { startSeconds: 0.1114, endSeconds: 1.2228 },
      { startSeconds: 1.2228, endSeconds: 5.5555 }
    ],
    continuity: [
      {
        leftShotIndex: 0,
        rightShotIndex: 1,
        mergeWithNext: false,
        reasonCode: 'transition_boundary'
      }
    ]
  });

  assert.deepEqual(segments, [
    { startSeconds: 0.111, endSeconds: 1.223 },
    { startSeconds: 1.223, endSeconds: 5.556 }
  ]);
});

test('forces long segment under 30 seconds', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 45 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, [
    { startSeconds: 0, endSeconds: 22.5, forced: true },
    { startSeconds: 22.5, endSeconds: 45, forced: true }
  ]);
  assert.deepEqual(governed.problems, []);
});

test('accepts 3-5 second segment without forced marking', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 10, endSeconds: 14 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, [
    { startSeconds: 10, endSeconds: 14 }
  ]);
  assert.deepEqual(governed.problems, []);
});

test('marks isolated sub-minimum segment as duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 2.5 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0, endSeconds: 2.5 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('merges sub-minimum segment into nearest accepted neighbor', () => {
  const governed = enforceSegmentDurations({
    segments: [
      { startSeconds: 0, endSeconds: 4 },
      { startSeconds: 4, endSeconds: 6 }
    ],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, [
    { startSeconds: 0, endSeconds: 6 }
  ]);
  assert.deepEqual(governed.problems, []);
});

test('rounds accepted and problem output ranges to 3 decimals', () => {
  const acceptedGoverned = enforceSegmentDurations({
    segments: [
      { startSeconds: 0.1114, endSeconds: 3.4448 },
      { startSeconds: 3.4448, endSeconds: 4.6782 }
    ],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(acceptedGoverned.accepted, [
    { startSeconds: 0.111, endSeconds: 4.678 }
  ]);
  assert.deepEqual(acceptedGoverned.problems, []);

  const problemGoverned = enforceSegmentDurations({
    segments: [{ startSeconds: 10.1114, endSeconds: 12.2228 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 5,
    maximumSeconds: 30
  });

  assert.deepEqual(problemGoverned.accepted, []);
  assert.deepEqual(problemGoverned.problems, [
    {
      segment: { startSeconds: 10.111, endSeconds: 12.223 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('routes impossible merged split constraints to duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [
      { startSeconds: 0, endSeconds: 3 },
      { startSeconds: 3, endSeconds: 5 }
    ],
    minimumSeconds: 3,
    preferredMinimumSeconds: 3,
    maximumSeconds: 4
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0, endSeconds: 5 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('routes rounded forced split below minimum to duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 6.0008 }],
    minimumSeconds: 3.0004,
    preferredMinimumSeconds: 3.0004,
    maximumSeconds: 4
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0, endSeconds: 6.001 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('routes rounded forced split above maximum to duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 6.0012 }],
    minimumSeconds: 3.0006,
    preferredMinimumSeconds: 3.0006,
    maximumSeconds: 3.001
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0, endSeconds: 6.001 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('allows forced split when rounded output satisfies duration rules', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0, endSeconds: 5.9998 }],
    minimumSeconds: 3,
    preferredMinimumSeconds: 3,
    maximumSeconds: 3.001
  });

  assert.deepEqual(governed.accepted, [
    { startSeconds: 0, endSeconds: 3, forced: true },
    { startSeconds: 3, endSeconds: 6, forced: true }
  ]);
  assert.deepEqual(governed.problems, []);
});

test('routes non-forced rounded segment below minimum to duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0.0006, endSeconds: 3.0004 }],
    minimumSeconds: 2.9995,
    preferredMinimumSeconds: 2.9995,
    maximumSeconds: 30
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0.001, endSeconds: 3 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('routes non-forced rounded segment above maximum to duration problem', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0.0004, endSeconds: 3.0005 }],
    minimumSeconds: 1,
    preferredMinimumSeconds: 1,
    maximumSeconds: 3.0005
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0, endSeconds: 3.001 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('uses raw duration to decide forced split before rounded validation', () => {
  const governed = enforceSegmentDurations({
    segments: [{ startSeconds: 0.0006, endSeconds: 3.0014 }],
    minimumSeconds: 1,
    preferredMinimumSeconds: 1,
    maximumSeconds: 3.0007
  });

  assert.deepEqual(governed.accepted, []);
  assert.deepEqual(governed.problems, [
    {
      segment: { startSeconds: 0.001, endSeconds: 3.001 },
      problemCategory: 'duration-rule-unsatisfied'
    }
  ]);
});

test('rejects invalid and unsorted shots with clear errors', () => {
  assert.throws(() => {
    assembleSegments({
      shots: [{ startSeconds: 5, endSeconds: 5 }],
      continuity: []
    });
  }, /Shot endSeconds must be greater than startSeconds/);

  assert.throws(() => {
    assembleSegments({
      shots: [
        { startSeconds: 3, endSeconds: 5 },
        { startSeconds: 1, endSeconds: 2 }
      ],
      continuity: []
    });
  }, /Shots must be sorted by time/);
});

test('rejects continuity decisions that do not reference adjacent shots', () => {
  assert.throws(() => {
    assembleSegments({
      shots: [
        { startSeconds: 0, endSeconds: 1 },
        { startSeconds: 1, endSeconds: 2 }
      ],
      continuity: [
        {
          leftShotIndex: 0,
          rightShotIndex: 2,
          mergeWithNext: true,
          reasonCode: 'visual_continuity'
        }
      ]
    });
  }, /Continuity decision must reference an adjacent shot pair/);
});
