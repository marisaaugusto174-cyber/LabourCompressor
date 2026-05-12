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

interface IndexedSegment {
  readonly segment: SegmentTimeRange & { readonly forced?: boolean };
  readonly sourceIndex: number;
}

interface ClassifiedSegments {
  readonly accepted: readonly IndexedSegment[];
  readonly shortSegments: readonly {
    readonly segment: SegmentTimeRange;
    readonly sourceIndex: number;
  }[];
  readonly problems: readonly SegmentDurationProblem[];
}

interface GovernedIndexedSegments {
  readonly accepted: readonly IndexedSegment[];
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
  let segmentStartSeconds = input.shots[0].startSeconds;

  for (let shotIndex = 0; shotIndex < input.shots.length - 1; shotIndex += 1) {
    const decision = continuityByLeftShot.get(shotIndex);

    if (decision?.mergeWithNext === false) {
      segments.push(roundSegmentTimeRange({
        startSeconds: segmentStartSeconds,
        endSeconds: input.shots[shotIndex].endSeconds
      }));
      segmentStartSeconds = input.shots[shotIndex + 1].startSeconds;
    }
  }

  segments.push(roundSegmentTimeRange({
    startSeconds: segmentStartSeconds,
    endSeconds: input.shots[input.shots.length - 1].endSeconds
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

  for (const shortSegment of classifiedSegments.shortSegments) {
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

    accepted[targetIndex] = {
      sourceIndex: accepted[targetIndex].sourceIndex,
      segment: mergeSegments(
        accepted[targetIndex].segment,
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
    assertTimeRange(shots[shotIndex], 'Shot');

    if (
      shotIndex > 0 &&
      shots[shotIndex].startSeconds < shots[shotIndex - 1].endSeconds
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
}

function validateSegments(segments: readonly SegmentTimeRange[]): void {
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    assertTimeRange(segments[segmentIndex], 'Segment');

    if (
      segmentIndex > 0 &&
      segments[segmentIndex].startSeconds <
        segments[segmentIndex - 1].endSeconds
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

function splitSegmentUnderMaximum(
  segment: SegmentTimeRange & { readonly forced?: boolean },
  rules: DurationRules,
  sourceIndex: number
): GovernedIndexedSegments {
  const roundedSegment = roundAcceptedSegment(segment);
  const rawDurationSeconds = segment.endSeconds - segment.startSeconds;

  if (rawDurationSeconds <= rules.maximumSeconds) {
    return governRoundedUnsplitSegment(roundedSegment, rules, sourceIndex);
  }

  if (isRoundedRangeWithinDuration(roundedSegment, rules)) {
    return {
      accepted: [],
      problems: [createDurationProblem(segment)]
    };
  }

  const splitSegments = createRoundedForcedSegments(
    segment,
    rules.maximumSeconds,
    sourceIndex
  );

  if (!allIndexedSegmentsWithinDurationRules(splitSegments, rules)) {
    return {
      accepted: [],
      problems: [createDurationProblem(segment)]
    };
  }

  return { accepted: splitSegments, problems: [] };
}

function createRoundedForcedSegments(
  segment: SegmentTimeRange,
  maximumSeconds: number,
  sourceIndex: number
): readonly IndexedSegment[] {
  const durationSeconds = segment.endSeconds - segment.startSeconds;
  const windowCount = Math.ceil(durationSeconds / maximumSeconds);
  const windowSeconds = durationSeconds / windowCount;
  const splitSegments: IndexedSegment[] = [];

  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    splitSegments.push({
      sourceIndex,
      segment: createRoundedForcedSegment(
        segment,
        windowIndex,
        windowCount,
        windowSeconds
      )
    });
  }

  return splitSegments;
}

function createRoundedForcedSegment(
  segment: SegmentTimeRange,
  windowIndex: number,
  windowCount: number,
  windowSeconds: number
): SegmentTimeRange & { readonly forced: true } {
  return {
    startSeconds:
      windowIndex === 0
        ? roundSeconds(segment.startSeconds)
        : roundSeconds(segment.startSeconds + windowSeconds * windowIndex),
    endSeconds:
      windowIndex === windowCount - 1
        ? roundSeconds(segment.endSeconds)
        : roundSeconds(segment.startSeconds + windowSeconds * (windowIndex + 1)),
    forced: true
  };
}

function governRoundedUnsplitSegment(
  segment: SegmentTimeRange & { readonly forced?: boolean },
  rules: DurationRules,
  sourceIndex: number
): GovernedIndexedSegments {
  if (isRoundedRangeWithinDuration(segment, rules)) {
    return { accepted: [{ segment, sourceIndex }], problems: [] };
  }

  return {
    accepted: [],
    problems: [createDurationProblem(segment)]
  };
}

function splitSegmentWhenNeeded(
  segment: SegmentTimeRange & { readonly forced?: boolean },
  rules: DurationRules,
  sourceIndex: number
): GovernedIndexedSegments {
  return splitSegmentUnderMaximum(
    segment,
    rules,
    sourceIndex
  );
}

function allIndexedSegmentsWithinDurationRules(
  segments: readonly IndexedSegment[],
  rules: DurationRules
): boolean {
  return segments.every(({ segment }) => {
    return isRoundedRangeWithinDuration(segment, rules);
  });
}

function isRoundedRangeWithinDuration(
  range: SegmentTimeRange,
  rules: DurationRules
): boolean {
  const roundedRange = roundSegmentTimeRange(range);
  const durationSeconds =
    roundedRange.endSeconds - roundedRange.startSeconds;

  return (
    durationSeconds >= rules.minimumSeconds &&
    durationSeconds <= rules.maximumSeconds
  );
}

function findNearestAcceptedSegmentIndex(
  accepted: readonly IndexedSegment[],
  segment: SegmentTimeRange,
  sourceIndex: number
): number | undefined {
  let previousIndex: number | undefined;
  let nextIndex: number | undefined;

  for (let index = 0; index < accepted.length; index += 1) {
    if (accepted[index].sourceIndex < sourceIndex) {
      previousIndex = index;
      continue;
    }

    nextIndex = index;
    break;
  }

  if (previousIndex === undefined) {
    return nextIndex;
  }

  if (nextIndex === undefined) {
    return previousIndex;
  }

  const previousDistance = Math.abs(
    segment.startSeconds - accepted[previousIndex].segment.endSeconds
  );
  const nextDistance = Math.abs(
    accepted[nextIndex].segment.startSeconds - segment.endSeconds
  );

  return previousDistance <= nextDistance ? previousIndex : nextIndex;
}

function mergeSegments(
  accepted: SegmentTimeRange & { readonly forced?: boolean },
  segment: SegmentTimeRange
): SegmentTimeRange & { readonly forced?: boolean } {
  return {
    startSeconds: Math.min(accepted.startSeconds, segment.startSeconds),
    endSeconds: Math.max(accepted.endSeconds, segment.endSeconds),
    ...(accepted.forced === true ? { forced: true } : {})
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundSegmentTimeRange(segment: SegmentTimeRange): SegmentTimeRange {
  return {
    startSeconds: roundSeconds(segment.startSeconds),
    endSeconds: roundSeconds(segment.endSeconds)
  };
}

function roundAcceptedSegment(
  segment: SegmentTimeRange & { readonly forced?: boolean }
): SegmentTimeRange & { readonly forced?: boolean } {
  return {
    ...roundSegmentTimeRange(segment),
    ...(segment.forced === true ? { forced: true } : {})
  };
}

function createDurationProblem(
  segment: SegmentTimeRange
): SegmentDurationProblem {
  return {
    segment: roundSegmentTimeRange(segment),
    problemCategory: 'duration-rule-unsatisfied'
  };
}
