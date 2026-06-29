import { type CandidateShot } from './segmentation-policy.ts';

export type ContinuityVerdict = 'continuous' | 'discontinuous' | 'unknown';
export type BoundaryContinuityClassification =
  | 'strong-continuity'
  | 'strong-boundary'
  | 'weak-or-unknown';

export interface ContinuityThresholds {
  readonly visual: {
    readonly histogramContinuousMinimum: number;
    readonly histogramBreakMaximum: number;
    readonly frameDifferenceContinuousMaximum: number;
    readonly frameDifferenceBreakMinimum: number;
  };
  readonly motion: {
    readonly stillMagnitudeMaximum: number;
    readonly directionContinuousMinimum: number;
    readonly directionBreakMaximum: number;
    readonly magnitudeRatioContinuousMaximum: number;
    readonly magnitudeRatioBreakMinimum: number;
  };
  readonly audio: {
    readonly silenceDbMaximum: number;
    readonly rmsDeltaContinuousMaximum: number;
    readonly rmsDeltaBreakMinimum: number;
    readonly spectrumContinuousMinimum: number;
    readonly spectrumBreakMaximum: number;
  };
  readonly sampling: {
    readonly frameWidth: number;
    readonly frameHeight: number;
    readonly windowSeconds: number;
    readonly audioSampleRate: number;
  };
}

export const DEFAULT_CONTINUITY_THRESHOLDS: ContinuityThresholds = Object.freeze({
  visual: Object.freeze({
    histogramContinuousMinimum: 0.8,
    histogramBreakMaximum: 0.45,
    frameDifferenceContinuousMaximum: 0.18,
    frameDifferenceBreakMinimum: 0.35
  }),
  motion: Object.freeze({
    stillMagnitudeMaximum: 0.5,
    directionContinuousMinimum: 0.5,
    directionBreakMaximum: -0.2,
    magnitudeRatioContinuousMaximum: 2,
    magnitudeRatioBreakMinimum: 4
  }),
  audio: Object.freeze({
    silenceDbMaximum: -45,
    rmsDeltaContinuousMaximum: 6,
    rmsDeltaBreakMinimum: 12,
    spectrumContinuousMinimum: 0.8,
    spectrumBreakMaximum: 0.5
  }),
  sampling: Object.freeze({
    frameWidth: 320,
    frameHeight: 180,
    windowSeconds: 0.5,
    audioSampleRate: 16_000
  })
});

export interface VisualContinuityMetrics {
  readonly histogramSimilarity: number;
  readonly normalizedFrameDifference: number;
}

export interface MotionContinuityMetrics {
  readonly beforeMagnitude: number;
  readonly afterMagnitude: number;
  readonly directionCosine: number;
  readonly magnitudeRatio: number;
}

export type AudioContinuityMetrics =
  | { readonly available: false }
  | {
    readonly available: true;
    readonly beforeRmsDb: number;
    readonly afterRmsDb: number;
    readonly rmsDeltaDb: number;
    readonly spectrumCosine: number;
  };

export interface ContinuitySignalResult<TMetrics> {
  readonly verdict: ContinuityVerdict;
  readonly metrics: TMetrics;
}

export interface BoundaryContinuityDecision {
  readonly boundarySeconds: number;
  readonly visual: ContinuitySignalResult<VisualContinuityMetrics>;
  readonly motion: ContinuitySignalResult<MotionContinuityMetrics>;
  readonly audio: ContinuitySignalResult<AudioContinuityMetrics>;
  readonly classification: BoundaryContinuityClassification;
}

export interface ContinuityAnalyzerPort {
  analyzeBoundaries(input: {
    readonly filePath: string;
    readonly shots: readonly CandidateShot[];
    readonly thresholds: ContinuityThresholds;
  }): Promise<readonly BoundaryContinuityDecision[]>;
}

export function classifyVisualContinuity(
  metrics: VisualContinuityMetrics,
  thresholds: ContinuityThresholds
): ContinuityVerdict {
  if (
    metrics.histogramSimilarity <= thresholds.visual.histogramBreakMaximum ||
    metrics.normalizedFrameDifference >= thresholds.visual.frameDifferenceBreakMinimum
  ) return 'discontinuous';
  if (
    metrics.histogramSimilarity >= thresholds.visual.histogramContinuousMinimum &&
    metrics.normalizedFrameDifference <= thresholds.visual.frameDifferenceContinuousMaximum
  ) return 'continuous';
  return 'unknown';
}

export function classifyMotionContinuity(
  metrics: MotionContinuityMetrics,
  thresholds: ContinuityThresholds
): ContinuityVerdict {
  const bothStill = metrics.beforeMagnitude <= thresholds.motion.stillMagnitudeMaximum &&
    metrics.afterMagnitude <= thresholds.motion.stillMagnitudeMaximum;
  if (bothStill) return 'continuous';
  if (
    metrics.directionCosine <= thresholds.motion.directionBreakMaximum ||
    metrics.magnitudeRatio >= thresholds.motion.magnitudeRatioBreakMinimum
  ) return 'discontinuous';
  if (
    metrics.directionCosine >= thresholds.motion.directionContinuousMinimum &&
    metrics.magnitudeRatio <= thresholds.motion.magnitudeRatioContinuousMaximum
  ) return 'continuous';
  return 'unknown';
}

export function classifyAudioContinuity(
  metrics: AudioContinuityMetrics,
  thresholds: ContinuityThresholds
): ContinuityVerdict {
  if (!metrics.available) return 'unknown';
  const bothSilent = metrics.beforeRmsDb <= thresholds.audio.silenceDbMaximum &&
    metrics.afterRmsDb <= thresholds.audio.silenceDbMaximum;
  if (bothSilent) return 'continuous';
  if (
    metrics.rmsDeltaDb >= thresholds.audio.rmsDeltaBreakMinimum ||
    metrics.spectrumCosine <= thresholds.audio.spectrumBreakMaximum
  ) return 'discontinuous';
  if (
    metrics.rmsDeltaDb <= thresholds.audio.rmsDeltaContinuousMaximum &&
    metrics.spectrumCosine >= thresholds.audio.spectrumContinuousMinimum
  ) return 'continuous';
  return 'unknown';
}

export function fuseContinuitySignals(
  verdicts: readonly ContinuityVerdict[]
): BoundaryContinuityClassification {
  const continuous = verdicts.filter((value) => value === 'continuous').length;
  const discontinuous = verdicts.filter((value) => value === 'discontinuous').length;
  if (continuous >= 2) return 'strong-continuity';
  if (discontinuous >= 2) return 'strong-boundary';
  return 'weak-or-unknown';
}
