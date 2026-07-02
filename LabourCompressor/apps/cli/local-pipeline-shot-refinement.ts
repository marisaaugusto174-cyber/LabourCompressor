import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type CandidateShot,
  type ShotBoundaryRefinementDecision,
  type ShotBoundaryRefinementResult,
  type ShotBoundaryRefinerPort
} from '../../packages/features/segmentation/domain/index.ts';

export interface ShotBoundaryRefinementResolution {
  readonly result: ShotBoundaryRefinementResult;
  readonly fallbackApplied: boolean;
  readonly fallbackReason?: 'boundary-refinement-failed' | undefined;
}

export async function resolveShotBoundaryRefinement(input: {
  readonly filePath: string;
  readonly shots: readonly CandidateShot[];
  readonly durationSeconds: number;
  readonly frameRate: number;
  readonly nominalFrameRate?: number | undefined;
  readonly averageFrameRate?: number | undefined;
  readonly frameCount?: number | undefined;
  readonly frameRateSource?: 'frame-count' | 'average' | 'nominal' | undefined;
  readonly variableFrameRate?: boolean | undefined;
  readonly refiner: ShotBoundaryRefinerPort;
  readonly diagnosticsDirectoryPath: string;
  readonly signal?: AbortSignal | undefined;
}): Promise<ShotBoundaryRefinementResolution> {
  input.signal?.throwIfAborted();
  let resolution: ShotBoundaryRefinementResolution;
  try {
    const result = await input.refiner.refineShots({
      filePath: input.filePath,
      shots: input.shots,
      durationSeconds: input.durationSeconds,
      frameRate: input.frameRate,
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
    resolution = Object.freeze({ result, fallbackApplied: false });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    resolution = Object.freeze({
      result: createOriginalBoundaryResult(input.shots),
      fallbackApplied: true,
      fallbackReason: 'boundary-refinement-failed' as const
    });
  }
  input.signal?.throwIfAborted();
  await writeBoundaryRefinementDiagnostic(input, resolution);
  return resolution;
}

function createOriginalBoundaryResult(
  shots: readonly CandidateShot[]
): ShotBoundaryRefinementResult {
  return Object.freeze({
    algorithmVersion: 'atomic-boundary-refinement-v1',
    shots: Object.freeze([...shots]),
    boundaries: Object.freeze(shots.slice(0, -1).map(createOriginalBoundary))
  });
}

function createOriginalBoundary(shot: CandidateShot): ShotBoundaryRefinementDecision {
  return Object.freeze({
    originalSeconds: shot.endSeconds,
    refinedSeconds: shot.endSeconds,
    ...(shot.endFrame === undefined ? {} : { refinedFrame: shot.endFrame }),
    accepted: true,
    reason: 'fallback-original-boundary',
    metrics: Object.freeze({})
  });
}

async function writeBoundaryRefinementDiagnostic(
  input: {
    readonly diagnosticsDirectoryPath: string;
    readonly shots: readonly CandidateShot[];
    readonly durationSeconds: number;
    readonly frameRate: number;
    readonly nominalFrameRate?: number | undefined;
    readonly averageFrameRate?: number | undefined;
    readonly frameCount?: number | undefined;
    readonly frameRateSource?: 'frame-count' | 'average' | 'nominal' | undefined;
    readonly variableFrameRate?: boolean | undefined;
  },
  resolution: ShotBoundaryRefinementResolution
): Promise<void> {
  await mkdir(input.diagnosticsDirectoryPath, { recursive: true });
  const finalPath = path.join(input.diagnosticsDirectoryPath, 'boundary-refinement.json');
  const partPath = `${finalPath}.part`;
  const payload = {
    algorithmVersion: resolution.result.algorithmVersion,
    durationSeconds: input.durationSeconds,
    frameRate: input.frameRate,
    ...(input.nominalFrameRate === undefined ? {} : { nominalFrameRate: input.nominalFrameRate }),
    ...(input.averageFrameRate === undefined ? {} : { averageFrameRate: input.averageFrameRate }),
    ...(input.frameCount === undefined ? {} : { frameCount: input.frameCount }),
    ...(input.frameRateSource === undefined ? {} : { frameRateSource: input.frameRateSource }),
    ...(input.variableFrameRate === undefined ? {} : { variableFrameRate: input.variableFrameRate }),
    candidateShots: input.shots,
    boundaries: resolution.result.boundaries,
    finalShots: resolution.result.shots,
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
