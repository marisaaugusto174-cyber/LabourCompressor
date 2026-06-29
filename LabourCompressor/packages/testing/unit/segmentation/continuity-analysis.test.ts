import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CONTINUITY_THRESHOLDS,
  classifyAudioContinuity,
  classifyMotionContinuity,
  classifyVisualContinuity,
  fuseContinuitySignals
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
