import {
  type BoundaryContinuityClassification,
  type BoundaryContinuityDecision
} from './continuity-analysis.ts';
import {
  type CandidateShot,
  type EnforceSegmentDurationsResult,
  type SegmentTimeRange
} from './segmentation-policy.ts';

export interface ContinuitySegmentationRules {
  readonly minimumSeconds: number;
  readonly preferredMaximumSeconds: number;
  readonly maximumSeconds: number;
}

interface ShotRange {
  readonly firstIndex: number;
  readonly lastIndex: number;
}

interface SplitCandidate {
  readonly boundaryIndex: number;
  readonly classification: BoundaryContinuityClassification;
  readonly boundarySeconds: number;
}

export function assembleContinuityFirstSegments(input: {
  readonly shots: readonly CandidateShot[];
  readonly continuity: readonly BoundaryContinuityDecision[];
  readonly rules: ContinuitySegmentationRules;
}): EnforceSegmentDurationsResult {
  validateInput(input);
  if (input.shots.length === 0) return { accepted: [], problems: [] };
  const accepted: (SegmentTimeRange & { readonly forced?: boolean })[] = [];
  const problems: EnforceSegmentDurationsResult['problems'][number][] = [];
  partitionRange(
    input,
    { firstIndex: 0, lastIndex: input.shots.length - 1 },
    accepted,
    problems
  );
  return {
    accepted: Object.freeze(accepted),
    problems: Object.freeze(problems)
  };
}

function partitionRange(
  input: Parameters<typeof assembleContinuityFirstSegments>[0],
  range: ShotRange,
  accepted: (SegmentTimeRange & { readonly forced?: boolean })[],
  problems: EnforceSegmentDurationsResult['problems'][number][]
): void {
  const segment = rangeToSegment(input.shots, range);
  const duration = segment.endSeconds - segment.startSeconds;
  if (duration < input.rules.minimumSeconds) {
    problems.push({ segment, problemCategory: 'duration-rule-unsatisfied' });
    return;
  }
  const split = chooseSplit(input, range, duration);
  if (split !== undefined) {
    partitionRange(input, { firstIndex: range.firstIndex, lastIndex: split }, accepted, problems);
    partitionRange(input, { firstIndex: split + 1, lastIndex: range.lastIndex }, accepted, problems);
    return;
  }
  if (duration <= input.rules.maximumSeconds) {
    accepted.push(segment);
    return;
  }
  accepted.push(...forceSplit(segment, input.rules));
}

function chooseSplit(
  input: Parameters<typeof assembleContinuityFirstSegments>[0],
  range: ShotRange,
  duration: number
): number | undefined {
  const candidates = buildCandidates(input, range);
  const eligible = candidates.filter((candidate) =>
    isEligible(candidate, input, range, duration)
  );
  eligible.sort((left, right) => compareCandidates(left, right, input, range, duration));
  return eligible[0]?.boundaryIndex;
}

function buildCandidates(
  input: Parameters<typeof assembleContinuityFirstSegments>[0],
  range: ShotRange
): readonly SplitCandidate[] {
  const candidates: SplitCandidate[] = [];
  for (let boundaryIndex = range.firstIndex; boundaryIndex < range.lastIndex; boundaryIndex += 1) {
    const decision = input.continuity[boundaryIndex]!;
    candidates.push({
      boundaryIndex,
      classification: decision.classification,
      boundarySeconds: decision.boundarySeconds
    });
  }
  return candidates;
}

function isEligible(
  candidate: SplitCandidate,
  input: Parameters<typeof assembleContinuityFirstSegments>[0],
  range: ShotRange,
  duration: number
): boolean {
  const start = input.shots[range.firstIndex]!.startSeconds;
  const end = input.shots[range.lastIndex]!.endSeconds;
  if (
    candidate.boundarySeconds - start < input.rules.minimumSeconds ||
    end - candidate.boundarySeconds < input.rules.minimumSeconds
  ) return false;
  if (duration > input.rules.maximumSeconds) return true;
  if (duration > input.rules.preferredMaximumSeconds) {
    return candidate.classification !== 'strong-continuity';
  }
  return candidate.classification === 'strong-boundary';
}

function compareCandidates(
  left: SplitCandidate,
  right: SplitCandidate,
  input: Parameters<typeof assembleContinuityFirstSegments>[0],
  range: ShotRange,
  duration: number
): number {
  const rankDifference = classificationRank(left.classification, duration, input.rules) -
    classificationRank(right.classification, duration, input.rules);
  if (rankDifference !== 0) return rankDifference;
  const start = input.shots[range.firstIndex]!.startSeconds;
  const leftDistance = Math.abs(left.boundarySeconds - start - input.rules.preferredMaximumSeconds);
  const rightDistance = Math.abs(right.boundarySeconds - start - input.rules.preferredMaximumSeconds);
  return leftDistance - rightDistance || left.boundarySeconds - right.boundarySeconds;
}

function classificationRank(
  value: BoundaryContinuityClassification,
  duration: number,
  rules: ContinuitySegmentationRules
): number {
  if (value === 'strong-boundary') return 0;
  if (value === 'weak-or-unknown') return 1;
  return duration > rules.maximumSeconds ? 2 : 3;
}

function forceSplit(
  segment: SegmentTimeRange,
  rules: ContinuitySegmentationRules
): readonly (SegmentTimeRange & { readonly forced: true })[] {
  const duration = segment.endSeconds - segment.startSeconds;
  const count = Math.ceil(duration / rules.preferredMaximumSeconds);
  const windowSeconds = duration / count;
  return Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
    startSeconds: roundSeconds(index === 0
      ? segment.startSeconds
      : segment.startSeconds + windowSeconds * index),
    endSeconds: roundSeconds(index === count - 1
      ? segment.endSeconds
      : segment.startSeconds + windowSeconds * (index + 1)),
    forced: true as const
  })));
}

function rangeToSegment(shots: readonly CandidateShot[], range: ShotRange): SegmentTimeRange {
  return Object.freeze({
    startSeconds: roundSeconds(shots[range.firstIndex]!.startSeconds),
    endSeconds: roundSeconds(shots[range.lastIndex]!.endSeconds)
  });
}

function validateInput(input: Parameters<typeof assembleContinuityFirstSegments>[0]): void {
  if (
    input.rules.minimumSeconds <= 0 ||
    input.rules.minimumSeconds > input.rules.preferredMaximumSeconds ||
    input.rules.preferredMaximumSeconds > input.rules.maximumSeconds
  ) throw new Error('Continuity segmentation duration rules are invalid.');
  if (input.continuity.length !== Math.max(0, input.shots.length - 1)) {
    throw new Error('Continuity decisions must cover every adjacent shot boundary.');
  }
  for (let index = 0; index < input.shots.length; index += 1) {
    validateShot(input.shots[index]!, input.shots[index - 1]);
    if (index > 0 && Math.abs(
      input.continuity[index - 1]!.boundarySeconds - input.shots[index - 1]!.endSeconds
    ) > 0.001) throw new Error('Continuity decision boundary does not match detected shots.');
  }
}

function validateShot(shot: CandidateShot, previous: CandidateShot | undefined): void {
  if (!Number.isFinite(shot.startSeconds) || !Number.isFinite(shot.endSeconds) ||
    shot.startSeconds < 0 || shot.endSeconds <= shot.startSeconds) {
    throw new Error('Detected shot range is invalid.');
  }
  if (previous !== undefined && Math.abs(shot.startSeconds - previous.endSeconds) > 0.001) {
    throw new Error('Detected shots must be contiguous and sorted.');
  }
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
