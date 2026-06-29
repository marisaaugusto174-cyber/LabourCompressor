import {
  findNearestAcceptedSegmentIndex,
  mergeSegments,
  roundAcceptedSegment,
  roundSegmentTimeRange,
  splitSegmentWhenNeeded,
  type GovernedIndexedSegments,
  type IndexedSegment
} from './segmentation-duration-helpers.ts';

export interface CandidateShot {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface ContinuityDecision {
  readonly leftShotIndex: number;
  readonly rightShotIndex: number;
  readonly mergeWithNext: boolean;
  readonly reasonCode:
    | 'visual_continuity'
    | 'action_continuity'
    | 'audio_continuity'
    | 'text_continuity'
    | 'transition_boundary'
    | 'weak_continuity';
}

export interface SegmentTimeRange {
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface EnforceSegmentDurationsInput {
  readonly segments: readonly SegmentTimeRange[];
  readonly minimumSeconds: number;
  readonly preferredMinimumSeconds: number;
  readonly preferredMaximumSeconds?: number | undefined;
  readonly maximumSeconds: number;
}

export interface SegmentDurationProblem {
  readonly segment: SegmentTimeRange;
  readonly problemCategory: 'duration-rule-unsatisfied';
}

export interface EnforceSegmentDurationsResult {
  readonly accepted: readonly (SegmentTimeRange & { readonly forced?: boolean })[];
  readonly problems: readonly SegmentDurationProblem[];
}

interface ClassifiedSegments {
  readonly accepted: readonly IndexedSegment[];
  readonly shortSegments: readonly {
    readonly segment: SegmentTimeRange;
    readonly sourceIndex: number;
  }[];
  readonly problems: readonly SegmentDurationProblem[];
}

interface DurationRules {
  readonly minimumSeconds: number;
  readonly maximumSeconds: number;
}

export function assembleSegments(input: {
  readonly shots: readonly CandidateShot[];
  readonly continuity: readonly ContinuityDecision[];
}): readonly SegmentTimeRange[] {
  validateShots(input.shots);

  if (input.shots.length === 0) {
    return [];
  }

  const continuityByLeftShot = buildContinuityByLeftShot(
    input.continuity,
    input.shots.length
  );
  const segments: SegmentTimeRange[] = [];
  let segmentStartSeconds = input.shots[0]!.startSeconds;

  for (let shotIndex = 0; shotIndex < input.shots.length - 1; shotIndex += 1) {
    const decision = continuityByLeftShot.get(shotIndex);

    if (decision?.mergeWithNext === false) {
      segments.push(roundSegmentTimeRange({
        startSeconds: segmentStartSeconds,
        endSeconds: input.shots[shotIndex]!.endSeconds
      }));
      segmentStartSeconds = input.shots[shotIndex + 1]!.startSeconds;
    }
  }

  segments.push(roundSegmentTimeRange({
    startSeconds: segmentStartSeconds,
    endSeconds: input.shots[input.shots.length - 1]!.endSeconds
  }));

  return segments;
}

export function enforceSegmentDurations(
  input: EnforceSegmentDurationsInput
): EnforceSegmentDurationsResult {
  validateDurationRules(input);
  validateSegments(input.segments);

  const classifiedSegments = classifySegmentsByDuration(input);
  const governedSegments = mergeShortSegmentsIntoAccepted(
    classifiedSegments,
    input.minimumSeconds,
    input.maximumSeconds
  );

  return {
    accepted: sortIndexedSegments(governedSegments.accepted).map(
      ({ segment }) => roundAcceptedSegment(segment)
    ),
    problems: governedSegments.problems
  };
}

function classifySegmentsByDuration(
  input: EnforceSegmentDurationsInput
): ClassifiedSegments {
  const accepted: IndexedSegment[] = [];
  const problems: SegmentDurationProblem[] = [];
  const shortSegments: readonly {
    readonly segment: SegmentTimeRange;
    readonly sourceIndex: number;
  }[] = input.segments
    .map((segment, sourceIndex) => ({ segment, sourceIndex }))
    .filter(({ segment, sourceIndex }) => {
      const durationSeconds = segment.endSeconds - segment.startSeconds;

      if (durationSeconds < input.minimumSeconds) {
        return true;
      }

      const splitResult = splitSegmentWhenNeeded(
        segment,
        input,
        sourceIndex
      );
      accepted.push(...splitResult.accepted);
      problems.push(...splitResult.problems);
      return false;
    });

  return { accepted, shortSegments, problems };
}

function mergeShortSegmentsIntoAccepted(
  classifiedSegments: ClassifiedSegments,
  minimumSeconds: number,
  maximumSeconds: number
): GovernedIndexedSegments {
  let accepted = [...classifiedSegments.accepted];
  const problems: SegmentDurationProblem[] = [...classifiedSegments.problems];
  const remainingShortSegments: ClassifiedSegments['shortSegments'][number][] = [];

  for (const run of groupConsecutiveShortSegments(classifiedSegments.shortSegments)) {
    const mergedRun = mergeSegmentRun(run);
    const durationSeconds = mergedRun.endSeconds - mergedRun.startSeconds;

    if (durationSeconds < minimumSeconds) {
      remainingShortSegments.push(...run);
      continue;
    }

    const splitResult = splitSegmentWhenNeeded(
      mergedRun,
      { minimumSeconds, maximumSeconds },
      run[0]!.sourceIndex
    );
    accepted.push(...splitResult.accepted);
    problems.push(...splitResult.problems);
  }

  for (const shortSegment of remainingShortSegments) {
    const targetIndex = findNearestAcceptedSegmentIndex(
      accepted,
      shortSegment.segment,
      shortSegment.sourceIndex
    );

    if (targetIndex === undefined) {
      problems.push({
        segment: roundSegmentTimeRange(shortSegment.segment),
        problemCategory: 'duration-rule-unsatisfied'
      });
      continue;
    }

    const target = accepted[targetIndex]!;
    accepted[targetIndex] = {
      sourceIndex: target.sourceIndex,
      segment: mergeSegments(
        target.segment,
        shortSegment.segment
      )
    };
  }

  const splitResult = splitAcceptedSegmentsWhenNeeded(
    accepted,
    { minimumSeconds, maximumSeconds }
  );

  return {
    accepted: splitResult.accepted,
    problems: [...problems, ...splitResult.problems]
  };
}

function groupConsecutiveShortSegments(
  shortSegments: ClassifiedSegments['shortSegments']
): readonly (readonly ClassifiedSegments['shortSegments'][number][])[] {
  const runs: ClassifiedSegments['shortSegments'][number][][] = [];
  let currentRun: ClassifiedSegments['shortSegments'][number][] = [];

  for (const shortSegment of shortSegments) {
    const previous = currentRun[currentRun.length - 1];
    const isConsecutive =
      previous !== undefined &&
      shortSegment.sourceIndex === previous.sourceIndex + 1 &&
      shortSegment.segment.startSeconds === previous.segment.endSeconds;

    if (previous !== undefined && !isConsecutive) {
      runs.push(currentRun);
      currentRun = [];
    }

    currentRun.push(shortSegment);
  }

  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  return runs;
}

function mergeSegmentRun(
  run: readonly ClassifiedSegments['shortSegments'][number][]
): SegmentTimeRange {
  const first = run[0];
  const last = run[run.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error('Short segment run must not be empty.');
  }
  return {
    startSeconds: first.segment.startSeconds,
    endSeconds: last.segment.endSeconds
  };
}

function splitAcceptedSegmentsWhenNeeded(
  accepted: readonly IndexedSegment[],
  rules: DurationRules
): GovernedIndexedSegments {
  const splitAccepted: IndexedSegment[] = [];
  const problems: SegmentDurationProblem[] = [];

  for (const indexedSegment of accepted) {
    const splitResult = splitSegmentWhenNeeded(
      indexedSegment.segment,
      rules,
      indexedSegment.sourceIndex
    );

    splitAccepted.push(...splitResult.accepted);
    problems.push(...splitResult.problems);
  }

  return { accepted: splitAccepted, problems };
}

function sortIndexedSegments(
  segments: readonly IndexedSegment[]
): readonly IndexedSegment[] {
  return [...segments].sort((left, right) => {
    if (left.segment.startSeconds === right.segment.startSeconds) {
      return left.segment.endSeconds - right.segment.endSeconds;
    }

    return left.segment.startSeconds - right.segment.startSeconds;
  });
}

function validateShots(shots: readonly CandidateShot[]): void {
  for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
    const shot = shots[shotIndex]!;
    assertTimeRange(shot, 'Shot');

    if (
      shotIndex > 0 &&
      shot.startSeconds < shots[shotIndex - 1]!.endSeconds
    ) {
      throw new Error('Shots must be sorted by time.');
    }
  }
}

function buildContinuityByLeftShot(
  continuity: readonly ContinuityDecision[],
  shotCount: number
): ReadonlyMap<number, ContinuityDecision> {
  const continuityByLeftShot = new Map<number, ContinuityDecision>();

  for (const decision of continuity) {
    validateContinuityDecision(decision, shotCount);

    if (continuityByLeftShot.has(decision.leftShotIndex)) {
      throw new Error('Continuity decision for shot pair must be unique.');
    }

    continuityByLeftShot.set(decision.leftShotIndex, decision);
  }

  return continuityByLeftShot;
}

function validateContinuityDecision(
  decision: ContinuityDecision,
  shotCount: number
): void {
  if (
    !Number.isInteger(decision.leftShotIndex) ||
    !Number.isInteger(decision.rightShotIndex)
  ) {
    throw new Error('Continuity decision shot indexes must be integers.');
  }

  if (
    decision.leftShotIndex < 0 ||
    decision.rightShotIndex < 0 ||
    decision.leftShotIndex >= shotCount ||
    decision.rightShotIndex >= shotCount ||
    decision.rightShotIndex !== decision.leftShotIndex + 1
  ) {
    throw new Error(
      'Continuity decision must reference an adjacent shot pair.'
    );
  }

  if (typeof decision.mergeWithNext !== 'boolean') {
    throw new Error('Continuity decision mergeWithNext must be boolean.');
  }

  if (!isContinuityReasonCode(decision.reasonCode)) {
    throw new Error('Continuity decision reasonCode must be known.');
  }
}

function isContinuityReasonCode(
  value: string
): value is ContinuityDecision['reasonCode'] {
  return (
    value === 'visual_continuity' ||
    value === 'action_continuity' ||
    value === 'audio_continuity' ||
    value === 'text_continuity' ||
    value === 'transition_boundary' ||
    value === 'weak_continuity'
  );
}

function validateDurationRules(input: EnforceSegmentDurationsInput): void {
  assertPositiveFinite(input.minimumSeconds, 'minimumSeconds');
  assertPositiveFinite(input.preferredMinimumSeconds, 'preferredMinimumSeconds');
  const preferredMaximumSeconds = input.preferredMaximumSeconds ?? input.maximumSeconds;
  assertPositiveFinite(preferredMaximumSeconds, 'preferredMaximumSeconds');
  assertPositiveFinite(input.maximumSeconds, 'maximumSeconds');

  if (input.minimumSeconds > input.preferredMinimumSeconds) {
    throw new Error(
      'minimumSeconds must be less than or equal to preferredMinimumSeconds.'
    );
  }

  if (input.preferredMinimumSeconds > input.maximumSeconds) {
    throw new Error(
      'preferredMinimumSeconds must be less than or equal to maximumSeconds.'
    );
  }
  if (input.preferredMinimumSeconds > preferredMaximumSeconds) {
    throw new Error(
      'preferredMinimumSeconds must be less than or equal to preferredMaximumSeconds.'
    );
  }
  if (preferredMaximumSeconds > input.maximumSeconds) {
    throw new Error(
      'preferredMaximumSeconds must be less than or equal to maximumSeconds.'
    );
  }
}

function validateSegments(segments: readonly SegmentTimeRange[]): void {
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex]!;
    assertTimeRange(segment, 'Segment');

    if (
      segmentIndex > 0 &&
      segment.startSeconds <
        segments[segmentIndex - 1]!.endSeconds
    ) {
      throw new Error('Segments must be sorted by time.');
    }
  }
}

function assertTimeRange(
  timeRange: SegmentTimeRange,
  fieldName: 'Segment' | 'Shot'
): void {
  if (!Number.isFinite(timeRange.startSeconds)) {
    throw new Error(`${fieldName} startSeconds must be finite.`);
  }

  if (!Number.isFinite(timeRange.endSeconds)) {
    throw new Error(`${fieldName} endSeconds must be finite.`);
  }

  if (timeRange.startSeconds < 0) {
    throw new Error(
      `${fieldName} startSeconds must be greater than or equal to 0.`
    );
  }

  if (timeRange.endSeconds <= timeRange.startSeconds) {
    throw new Error(
      `${fieldName} endSeconds must be greater than startSeconds.`
    );
  }
}

function assertPositiveFinite(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be positive and finite.`);
  }
}
