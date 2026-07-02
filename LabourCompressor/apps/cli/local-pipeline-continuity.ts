import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  assembleContinuityFirstSegments,
  resolveWeakBoundaryActivationSeconds,
  type BoundaryContinuityDecision,
  type CandidateShot,
  type ContinuityAnalyzerPort,
  type EnforceSegmentDurationsResult
} from '../../packages/features/segmentation/domain/index.ts';
import { type SegmentationProfileRules } from './segmentation-profiles.ts';

export interface ContinuitySegmentationResolution {
  readonly governed: EnforceSegmentDurationsResult;
  readonly decisions: readonly BoundaryContinuityDecision[];
  readonly fallbackApplied: boolean;
  readonly fallbackReason?: 'continuity-analysis-failed' | undefined;
}

export async function resolveContinuitySegmentation(input: {
  readonly filePath: string;
  readonly shots: readonly CandidateShot[];
  readonly rules: SegmentationProfileRules;
  readonly analyzer: ContinuityAnalyzerPort;
  readonly diagnosticsDirectoryPath: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<ContinuitySegmentationResolution> {
  input.signal?.throwIfAborted();
  let resolution: ContinuitySegmentationResolution;
  try {
    const decisions = await input.analyzer.analyzeBoundaries({
      filePath: input.filePath,
      shots: input.shots,
      thresholds: input.rules.continuityThresholds,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    resolution = createResolution(input.shots, decisions, input.rules, false);
  } catch (error) {
    if (isAbortError(error)) throw error;
    resolution = createResolution(
      input.shots,
      createMechanicalDecisions(input.shots),
      input.rules,
      true
    );
  }
  input.signal?.throwIfAborted();
  await writeContinuityDiagnostic(input, resolution);
  return resolution;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createResolution(
  shots: readonly CandidateShot[],
  decisions: readonly BoundaryContinuityDecision[],
  rules: SegmentationProfileRules,
  fallbackApplied: boolean
): ContinuitySegmentationResolution {
  return Object.freeze({
    governed: assembleContinuityFirstSegments({
      shots,
      continuity: decisions,
      rules: {
        minimumSeconds: rules.minimumSeconds,
        preferredMaximumSeconds: rules.preferredMaximumSeconds,
        maximumSeconds: rules.maximumSeconds
      }
    }),
    decisions,
    fallbackApplied,
    ...(fallbackApplied ? { fallbackReason: 'continuity-analysis-failed' as const } : {})
  });
}

function createMechanicalDecisions(
  shots: readonly CandidateShot[]
): readonly BoundaryContinuityDecision[] {
  return Object.freeze(shots.slice(0, -1).map((shot) => Object.freeze({
    boundarySeconds: shot.endSeconds,
    visual: unknownVisualSignal(),
    motion: unknownMotionSignal(),
    audio: Object.freeze({ verdict: 'unknown' as const, metrics: Object.freeze({ available: false as const }) }),
    classification: 'weak-or-unknown' as const
  })));
}

function unknownVisualSignal(): BoundaryContinuityDecision['visual'] {
  return Object.freeze({
    verdict: 'unknown',
    metrics: Object.freeze({ histogramSimilarity: 0, normalizedFrameDifference: 0 })
  });
}

function unknownMotionSignal(): BoundaryContinuityDecision['motion'] {
  return Object.freeze({
    verdict: 'unknown',
    metrics: Object.freeze({
      beforeMagnitude: 0, afterMagnitude: 0, directionCosine: 0, magnitudeRatio: 1
    })
  });
}

async function writeContinuityDiagnostic(
  input: {
    readonly diagnosticsDirectoryPath: string;
    readonly shots: readonly CandidateShot[];
    readonly rules: SegmentationProfileRules;
  },
  resolution: ContinuitySegmentationResolution
): Promise<void> {
  await mkdir(input.diagnosticsDirectoryPath, { recursive: true });
  const finalPath = path.join(input.diagnosticsDirectoryPath, 'continuity.json');
  const partPath = `${finalPath}.part`;
  const payload = {
    algorithmVersion: 'continuity-v1',
    durationPolicy: readDurationPolicy(input.rules),
    thresholds: input.rules.continuityThresholds,
    candidateShots: input.shots,
    boundaries: resolution.decisions,
    finalSegments: resolution.governed.accepted,
    problems: resolution.governed.problems,
    fallbackApplied: resolution.fallbackApplied,
    ...(resolution.fallbackReason === undefined ? {} : { fallbackReason: resolution.fallbackReason })
  };
  try {
    await writeFile(partPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(partPath, finalPath);
  } finally {
    await rm(partPath, { force: true });
  }
}

function readDurationPolicy(rules: SegmentationProfileRules) {
  return Object.freeze({
    minimumSeconds: rules.minimumSeconds,
    preferredMaximumSeconds: rules.preferredMaximumSeconds,
    weakBoundaryActivationSeconds: resolveWeakBoundaryActivationSeconds({
      minimumSeconds: rules.minimumSeconds,
      preferredMaximumSeconds: rules.preferredMaximumSeconds,
      maximumSeconds: rules.maximumSeconds
    }),
    maximumSeconds: rules.maximumSeconds
  });
}
