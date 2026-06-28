import {
  type SegmentDurationProblem,
  type SegmentTimeRange
} from './segmentation-policy.ts';

export interface IndexedSegment {
  readonly segment: SegmentTimeRange & { readonly forced?: boolean };
  readonly sourceIndex: number;
}

export interface GovernedIndexedSegments {
  readonly accepted: readonly IndexedSegment[];
  readonly problems: readonly SegmentDurationProblem[];
}

interface DurationRules {
  readonly minimumSeconds: number;
  readonly maximumSeconds: number;
}

export function splitSegmentWhenNeeded(
  segment: SegmentTimeRange & { readonly forced?: boolean },
  rules: DurationRules,
  sourceIndex: number
): GovernedIndexedSegments {
  return splitSegmentUnderMaximum(segment, rules, sourceIndex);
}

export function findNearestAcceptedSegmentIndex(
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

export function mergeSegments(
  accepted: SegmentTimeRange & { readonly forced?: boolean },
  segment: SegmentTimeRange
): SegmentTimeRange & { readonly forced?: boolean } {
  return {
    startSeconds: Math.min(accepted.startSeconds, segment.startSeconds),
    endSeconds: Math.max(accepted.endSeconds, segment.endSeconds),
    ...(accepted.forced === true ? { forced: true } : {})
  };
}

export function roundSegmentTimeRange(segment: SegmentTimeRange): SegmentTimeRange {
  return {
    startSeconds: roundSeconds(segment.startSeconds),
    endSeconds: roundSeconds(segment.endSeconds)
  };
}

export function roundAcceptedSegment(
  segment: SegmentTimeRange & { readonly forced?: boolean }
): SegmentTimeRange & { readonly forced?: boolean } {
  return {
    ...roundSegmentTimeRange(segment),
    ...(segment.forced === true ? { forced: true } : {})
  };
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

function allIndexedSegmentsWithinDurationRules(
  segments: readonly IndexedSegment[],
  rules: DurationRules
): boolean {
  return segments.every(({ segment }) => isRoundedRangeWithinDuration(segment, rules));
}

function isRoundedRangeWithinDuration(
  range: SegmentTimeRange,
  rules: DurationRules
): boolean {
  const roundedRange = roundSegmentTimeRange(range);
  const durationSeconds = roundedRange.endSeconds - roundedRange.startSeconds;

  return (
    durationSeconds >= rules.minimumSeconds &&
    durationSeconds <= rules.maximumSeconds
  );
}

function createDurationProblem(
  segment: SegmentTimeRange
): SegmentDurationProblem {
  return {
    segment: roundSegmentTimeRange(segment),
    problemCategory: 'duration-rule-unsatisfied'
  };
}

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
