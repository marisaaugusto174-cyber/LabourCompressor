import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleContinuityFirstSegments,
  type BoundaryContinuityClassification,
  type BoundaryContinuityDecision
} from '../../../features/segmentation/domain/index.ts';

const RULES = Object.freeze({
  minimumSeconds: 5,
  preferredMaximumSeconds: 30,
  maximumSeconds: 60
});

test('keeps a 42 second strong-continuity group intact', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 18), shot(18, 42)],
    continuity: [decision(18, 'strong-continuity')],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [{ startSeconds: 0, endSeconds: 42 }]);
});

test('splits a 35 second group at its strong boundary', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 18), shot(18, 35)],
    continuity: [decision(18, 'strong-boundary')],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 18), shot(18, 35)]);
});

test('keeps a weak boundary inside the thirty-to-forty second protection band', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 11.433), shot(11.433, 31.533)],
    continuity: [decision(11.433, 'weak-or-unknown')],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 31.533)]);
});

test('uses a weak boundary after the soft activation threshold', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 12), shot(12, 28), shot(28, 42)],
    continuity: [
      decision(12, 'strong-continuity'),
      decision(28, 'weak-or-unknown')
    ],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 28), shot(28, 42)]);
});

test('does not use a soft-ineligible weak boundary after the soft activation threshold', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 12), shot(12, 28), shot(28, 42)],
    continuity: [
      decision(12, 'strong-continuity'),
      decision(28, 'weak-or-unknown', false)
    ],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 42)]);
});

test('still uses soft-eligible weak boundaries after the soft activation threshold', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 12), shot(12, 28), shot(28, 42)],
    continuity: [
      decision(12, 'strong-continuity'),
      decision(28, 'weak-or-unknown', true)
    ],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 28), shot(28, 42)]);
});

test('forces a boundary-free 75 second shot into three 25 second ranges', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 75)],
    continuity: [],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [
    { startSeconds: 0, endSeconds: 25, forced: true },
    { startSeconds: 25, endSeconds: 50, forced: true },
    { startSeconds: 50, endSeconds: 75, forced: true }
  ]);
});

test('merges sub-five-second shots across early boundaries', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 2), shot(2, 6), shot(6, 14)],
    continuity: [
      decision(2, 'strong-boundary'),
      decision(6, 'strong-boundary')
    ],
    rules: RULES
  });

  assert.deepEqual(result.accepted, [shot(0, 6), shot(6, 14)]);
});

test('routes a source shorter than five seconds to duration problems', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 4)],
    continuity: [],
    rules: RULES
  });

  assert.deepEqual(result.accepted, []);
  assert.deepEqual(result.problems, [{
    segment: shot(0, 4),
    problemCategory: 'duration-rule-unsatisfied'
  }]);
});

test('keeps every accepted computed range inside five to sixty seconds', () => {
  const result = assembleContinuityFirstSegments({
    shots: [shot(0, 4), shot(4, 20), shot(20, 59), shot(59, 62), shot(62, 121)],
    continuity: [
      decision(4, 'strong-boundary'),
      decision(20, 'strong-boundary'),
      decision(59, 'strong-continuity'),
      decision(62, 'weak-or-unknown')
    ],
    rules: RULES
  });

  assert.equal(result.accepted.every((range) => {
    const duration = range.endSeconds - range.startSeconds;
    return duration >= 5 && duration <= 60;
  }), true);
});

function shot(startSeconds: number, endSeconds: number) {
  return { startSeconds, endSeconds };
}

function decision(
  boundarySeconds: number,
  classification: BoundaryContinuityClassification,
  softSplitEligible?: boolean
): BoundaryContinuityDecision {
  return {
    boundarySeconds,
    visual: {
      verdict: 'unknown',
      metrics: { histogramSimilarity: 0.7, normalizedFrameDifference: 0.25 }
    },
    motion: {
      verdict: 'unknown',
      metrics: {
        beforeMagnitude: 1, afterMagnitude: 1,
        directionCosine: 0, magnitudeRatio: 1
      }
    },
    audio: { verdict: 'unknown', metrics: { available: false } },
    classification,
    ...(softSplitEligible === undefined ? {} : { softSplitEligible })
  };
}
