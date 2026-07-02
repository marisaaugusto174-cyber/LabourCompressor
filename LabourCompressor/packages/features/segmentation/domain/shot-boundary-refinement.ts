import {
  type CandidateShot,
  type ShotBoundaryPseudoCutCategory,
  type ShotBoundaryQuality
} from './segmentation-policy.ts';

export interface ShotBoundaryRefinementDecision {
  readonly originalSeconds: number;
  readonly refinedSeconds: number;
  readonly refinedFrame?: number | undefined;
  readonly accepted: boolean;
  readonly reason: string;
  readonly quality?: ShotBoundaryQuality | undefined;
  readonly pseudoCutCategory?: ShotBoundaryPseudoCutCategory | undefined;
  readonly metrics: Readonly<Record<string, unknown>>;
}

export interface ShotBoundaryRefinementResult {
  readonly algorithmVersion: string;
  readonly shots: readonly CandidateShot[];
  readonly boundaries: readonly ShotBoundaryRefinementDecision[];
}

export interface ShotBoundaryRefinerPort {
  refineShots(input: {
    readonly filePath: string;
    readonly shots: readonly CandidateShot[];
    readonly durationSeconds: number;
    readonly frameRate: number;
    readonly signal?: AbortSignal | undefined;
  }): Promise<ShotBoundaryRefinementResult>;
}

export function applyShotBoundaryRefinements(input: {
  readonly algorithmVersion: string;
  readonly shots: readonly CandidateShot[];
  readonly durationSeconds: number;
  readonly frameRate: number;
  readonly boundaries: readonly ShotBoundaryRefinementDecision[];
}): ShotBoundaryRefinementResult {
  validateRefinementInput(input);
  const acceptedBoundaries = dedupeAcceptedBoundaries(input.boundaries, input);
  return Object.freeze({
    algorithmVersion: input.algorithmVersion,
    shots: buildRefinedShots(input, acceptedBoundaries),
    boundaries: Object.freeze([...input.boundaries])
  });
}

function dedupeAcceptedBoundaries(
  boundaries: readonly ShotBoundaryRefinementDecision[],
  input: Parameters<typeof applyShotBoundaryRefinements>[0]
): readonly ShotBoundaryRefinementDecision[] {
  const minimumGap = Math.max(1 / input.frameRate, 0.01);
  const accepted: ShotBoundaryRefinementDecision[] = [];
  for (const boundary of boundaries.filter((value) => value.accepted)
    .sort((left, right) => left.refinedSeconds - right.refinedSeconds)) {
    if (
      boundary.refinedSeconds <= input.shots[0]!.startSeconds ||
      boundary.refinedSeconds >= input.durationSeconds
    ) continue;
    if (accepted.length > 0 &&
      boundary.refinedSeconds - accepted[accepted.length - 1]!.refinedSeconds < minimumGap) {
      continue;
    }
    accepted.push(boundary);
  }
  return Object.freeze(accepted);
}

function buildRefinedShots(
  input: Parameters<typeof applyShotBoundaryRefinements>[0],
  boundaries: readonly ShotBoundaryRefinementDecision[]
): readonly CandidateShot[] {
  if (boundaries.length === 0) {
    return Object.freeze([Object.freeze({
      startSeconds: input.shots[0]!.startSeconds,
      endSeconds: roundSeconds(input.durationSeconds)
    })]);
  }
  const shots: CandidateShot[] = [];
  let startSeconds = input.shots[0]!.startSeconds;
  let startFrame: number | undefined = input.shots[0]!.startFrame;
  for (const boundary of boundaries) {
    shots.push(Object.freeze({
      startSeconds: roundSeconds(startSeconds),
      endSeconds: roundSeconds(boundary.refinedSeconds),
      ...(startFrame === undefined ? {} : { startFrame }),
      ...(boundary.refinedFrame === undefined ? {} : { endFrame: boundary.refinedFrame }),
      sourceBoundary: createSourceBoundary(boundary)
    }));
    startSeconds = boundary.refinedSeconds;
    startFrame = boundary.refinedFrame;
  }
  shots.push(Object.freeze({
    startSeconds: roundSeconds(startSeconds),
    endSeconds: roundSeconds(input.durationSeconds),
    ...(startFrame === undefined ? {} : { startFrame })
  }));
  return Object.freeze(shots);
}

function createSourceBoundary(
  boundary: ShotBoundaryRefinementDecision
): NonNullable<CandidateShot['sourceBoundary']> {
  return Object.freeze({
    originalSeconds: boundary.originalSeconds,
    refinedSeconds: boundary.refinedSeconds,
    ...(boundary.refinedFrame === undefined ? {} : { refinedFrame: boundary.refinedFrame }),
    accepted: boundary.accepted,
    reason: boundary.reason,
    ...(boundary.quality === undefined ? {} : { quality: boundary.quality }),
    ...(boundary.pseudoCutCategory === undefined ? {} : {
      pseudoCutCategory: boundary.pseudoCutCategory
    })
  });
}

function validateRefinementInput(input: Parameters<typeof applyShotBoundaryRefinements>[0]): void {
  if (input.shots.length === 0) throw new Error('Shot refinement requires at least one shot.');
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error('Shot refinement requires a positive duration.');
  }
  if (!Number.isFinite(input.frameRate) || input.frameRate <= 0) {
    throw new Error('Shot refinement requires a positive frame rate.');
  }
  for (const boundary of input.boundaries) validateBoundary(boundary);
}

function validateBoundary(boundary: ShotBoundaryRefinementDecision): void {
  if (
    !Number.isFinite(boundary.originalSeconds) ||
    !Number.isFinite(boundary.refinedSeconds) ||
    boundary.originalSeconds < 0 ||
    boundary.refinedSeconds < 0
  ) {
    throw new Error('Shot boundary refinement seconds must be finite.');
  }
  if (boundary.refinedFrame !== undefined &&
    (!Number.isInteger(boundary.refinedFrame) || boundary.refinedFrame < 0)) {
    throw new Error('Shot boundary refinement frame must be a non-negative integer.');
  }
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
