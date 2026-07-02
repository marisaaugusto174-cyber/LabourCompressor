import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONTINUITY_THRESHOLDS,
  classifyAudioContinuity,
  classifyMotionContinuity,
  classifyVisualContinuity,
  fuseContinuitySignals,
  normalizeBoundaryContinuityDecision
} from '../../../features/segmentation/domain/index.ts';

test('classifies visual continuity with continuous, broken and unknown bands', () => {
  assert.equal(classifyVisualContinuity({ histogramSimilarity: 0.9, normalizedFrameDifference: 0.1 }, DEFAULT_CONTINUITY_THRESHOLDS), 'continuous');
  assert.equal(classifyVisualContinuity({ histogramSimilarity: 0.4, normalizedFrameDifference: 0.2 }, DEFAULT_CONTINUITY_THRESHOLDS), 'discontinuous');
  assert.equal(classifyVisualContinuity({ histogramSimilarity: 0.7, normalizedFrameDifference: 0.25 }, DEFAULT_CONTINUITY_THRESHOLDS), 'unknown');
});

test('classifies motion continuity without claiming semantic action identity', () => {
  assert.equal(classifyMotionContinuity({ beforeMagnitude: 0.2, afterMagnitude: 0.3, directionCosine: 0, magnitudeRatio: 1.5 }, DEFAULT_CONTINUITY_THRESHOLDS), 'continuous');
  assert.equal(classifyMotionContinuity({ beforeMagnitude: 2, afterMagnitude: 2, directionCosine: 0.8, magnitudeRatio: 1 }, DEFAULT_CONTINUITY_THRESHOLDS), 'continuous');
  assert.equal(classifyMotionContinuity({ beforeMagnitude: 2, afterMagnitude: 2, directionCosine: -0.4, magnitudeRatio: 1 }, DEFAULT_CONTINUITY_THRESHOLDS), 'discontinuous');
});

test('classifies audio continuity and treats absent audio as unknown', () => {
  assert.equal(classifyAudioContinuity({ available: false }, DEFAULT_CONTINUITY_THRESHOLDS), 'unknown');
  assert.equal(classifyAudioContinuity({ available: true, beforeRmsDb: -60, afterRmsDb: -55, rmsDeltaDb: 5, spectrumCosine: 0.2 }, DEFAULT_CONTINUITY_THRESHOLDS), 'continuous');
  assert.equal(classifyAudioContinuity({ available: true, beforeRmsDb: -20, afterRmsDb: -23, rmsDeltaDb: 3, spectrumCosine: 0.9 }, DEFAULT_CONTINUITY_THRESHOLDS), 'continuous');
  assert.equal(classifyAudioContinuity({ available: true, beforeRmsDb: -20, afterRmsDb: -35, rmsDeltaDb: 15, spectrumCosine: 0.9 }, DEFAULT_CONTINUITY_THRESHOLDS), 'discontinuous');
});

test('fuses three signals by majority and keeps conflicts continuity-first', () => {
  assert.equal(fuseContinuitySignals(['continuous', 'continuous', 'discontinuous']), 'strong-continuity');
  assert.equal(fuseContinuitySignals(['discontinuous', 'discontinuous', 'continuous']), 'strong-boundary');
  assert.equal(fuseContinuitySignals(['continuous', 'discontinuous', 'unknown']), 'weak-or-unknown');
});

test('downgrades low-quality correlated visual and motion breaks when audio remains continuous', () => {
  const normalized = normalizeBoundaryContinuityDecision({
    boundarySeconds: 61.6,
    visual: {
      verdict: 'discontinuous',
      metrics: { histogramSimilarity: 0.057, normalizedFrameDifference: 0.44 }
    },
    motion: {
      verdict: 'discontinuous',
      metrics: {
        beforeMagnitude: 7.7,
        afterMagnitude: 4.7,
        directionCosine: -0.94,
        magnitudeRatio: 1.64
      }
    },
    audio: {
      verdict: 'continuous',
      metrics: {
        available: true,
        beforeRmsDb: -13.1,
        afterRmsDb: -10.6,
        rmsDeltaDb: 2.5,
        spectrumCosine: 0.97
      }
    },
    classification: 'strong-boundary'
  }, {
    quality: 'low',
    pseudoCutCategory: 'effect-flash-internal'
  });

  assert.equal(normalized.classification, 'weak-or-unknown');
  assert.equal(normalized.originalClassification, 'strong-boundary');
  assert.equal(normalized.normalizationReason, 'correlated-visual-motion-low-confidence');
  assert.equal(normalized.softSplitEligible, false);
});

test('keeps high-quality visual and motion breaks as strong boundaries', () => {
  const normalized = normalizeBoundaryContinuityDecision({
    boundarySeconds: 70.95,
    visual: {
      verdict: 'discontinuous',
      metrics: { histogramSimilarity: 0.42, normalizedFrameDifference: 0.19 }
    },
    motion: {
      verdict: 'discontinuous',
      metrics: {
        beforeMagnitude: 8.3,
        afterMagnitude: 1,
        directionCosine: -0.36,
        magnitudeRatio: 8
      }
    },
    audio: {
      verdict: 'continuous',
      metrics: {
        available: true,
        beforeRmsDb: -24,
        afterRmsDb: -28,
        rmsDeltaDb: 4,
        spectrumCosine: 0.98
      }
    },
    classification: 'strong-boundary'
  }, {
    quality: 'high'
  });

  assert.equal(normalized.classification, 'strong-boundary');
  assert.equal(normalized.originalClassification, undefined);
  assert.equal(normalized.normalizationReason, undefined);
  assert.equal(normalized.softSplitEligible, true);
});
